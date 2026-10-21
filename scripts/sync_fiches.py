#!/usr/bin/env python3
"""Synchronise les fiches techniques depuis le dossier Google Drive vers fiches/.

- Parcourt récursivement le dossier Drive et suit les raccourcis.
- Ne télécharge que les fichiers nouveaux ou modifiés (md5 Drive ; date pour les Google Docs).
- Compresse les PDF avec Ghostscript (l'original est gardé si la version compressée n'est pas plus petite).
- Garde tous les fichiers, y compris les non-PDF (images, Word, etc.).
- Écrit fiches/manifest.json et supprime de fiches/ les fichiers retirés du Drive.

Variable d'environnement requise : GDRIVE_SA_KEY (JSON du compte de service Google).
Le dossier Drive doit être partagé en lecture avec l'adresse e-mail du compte de service.
"""
import io
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

ROOT_ID = '10VQKz_cOCOKfU7K6FIZyTtUlDiIdeyxJ'  # dossier « FICHES TECHNIQUES »
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
FOLDER = 'application/vnd.google-apps.folder'
SHORTCUT = 'application/vnd.google-apps.shortcut'
GDOC_EXPORT = {
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation',
}

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / 'fiches'
FILES = OUT / 'files'
MANIFEST = OUT / 'manifest.json'
CATEGORIES = json.loads((Path(__file__).parent / 'categories.json').read_text(encoding='utf-8'))


def drive():
    info = json.loads(os.environ['GDRIVE_SA_KEY'])
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build('drive', 'v3', credentials=creds, cache_discovery=False)


def children(svc, folder_id):
    out, token = [], None
    while True:
        r = svc.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            fields='nextPageToken, files(id, name, mimeType, md5Checksum, modifiedTime)',
            pageSize=1000, pageToken=token,
            supportsAllDrives=True, includeItemsFromAllDrives=True,
        ).execute()
        out.extend(r.get('files', []))
        token = r.get('nextPageToken')
        if not token:
            return out


def walk(svc, folder_id, labels):
    """Produit (fichier, dossiers parents) pour tout l'arbre, raccourcis résolus."""
    for f in sorted(children(svc, folder_id), key=lambda x: x['name'].lower()):
        name = f['name'].strip()
        if f['mimeType'] == SHORTCUT:
            target = svc.files().get(
                fileId=f.get('shortcutDetails', {}).get('targetId') or f['id'],
                fields='id, mimeType, md5Checksum, modifiedTime',
                supportsAllDrives=True,
            ).execute()
            f = {**target, 'name': name}
        if f['mimeType'] == FOLDER:
            yield from walk(svc, f['id'], labels + [name])
        else:
            yield {**f, 'name': name}, labels


def clean(s):
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', s).strip().rstrip('.')
    return s or 'sans-nom'


def category_of(labels):
    parts = [CATEGORIES.get(label, label) for label in labels]
    return ' › '.join(parts) if parts else 'Divers'


def download(svc, f):
    if f['mimeType'] in GDOC_EXPORT:
        req = svc.files().export_media(fileId=f['id'], mimeType='application/pdf')
    else:
        req = svc.files().get_media(fileId=f['id'], supportsAllDrives=True)
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, req)
    done = False
    while not done:
        _, done = dl.next_chunk()
    return buf.getvalue()


def compress_pdf(data):
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp, 'in.pdf'), Path(tmp, 'out.pdf')
        src.write_bytes(data)
        try:
            subprocess.run(
                ['gs', '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite',
                 '-dCompatibilityLevel=1.5', '-dPDFSETTINGS=/ebook',
                 f'-sOutputFile={dst}', str(src)],
                check=True, timeout=900,
            )
            out = dst.read_bytes()
            if 0 < len(out) < len(data):
                return out
        except (subprocess.SubprocessError, OSError):
            pass
    return data


def main():
    svc = drive()
    old = json.loads(MANIFEST.read_text(encoding='utf-8')) if MANIFEST.exists() else {'items': []}
    old_by_id = {i['id']: i for i in old.get('items', [])}
    FILES.mkdir(parents=True, exist_ok=True)

    items, used = [], set()
    for f, labels in walk(svc, ROOT_ID, []):
        is_gdoc = f['mimeType'] in GDOC_EXPORT
        is_pdf = is_gdoc or f['mimeType'] == 'application/pdf'
        version = f.get('md5Checksum') or f['modifiedTime']

        base = clean(f['name'])
        if is_gdoc:
            base += '.pdf'
        rel = Path(*[clean(CATEGORIES.get(label, label)) for label in labels], base)
        key = rel.as_posix()
        if key in used:  # deux fichiers de même nom dans un même dossier
            rel = rel.with_name(f"{rel.stem} ({f['id'][:6]}){rel.suffix}")
            key = rel.as_posix()
        used.add(key)

        prev = old_by_id.get(f['id'])
        local = FILES / rel
        if not (prev and prev.get('version') == version and prev.get('path') == key and local.exists()):
            print(f'Téléchargement : {key}', flush=True)
            data = download(svc, f)
            if is_pdf:
                data = compress_pdf(data)
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(data)

        title = Path(base).stem if base.lower().endswith('.pdf') else base
        items.append({
            'id': f['id'],
            'title': title,
            'category': category_of(labels),
            'path': key,
            'url': 'fiches/files/' + quote(key, safe='/'),
            'version': version,
            'size': local.stat().st_size,
            'modifiedTime': f['modifiedTime'],
        })

    keep = {i['path'] for i in items}
    for gone in old.get('items', []):
        if gone['path'] not in keep:
            p = FILES / gone['path']
            if p.exists():
                p.unlink()
                print('Supprimé :', gone['path'])
    for d in sorted((p for p in FILES.rglob('*') if p.is_dir()), reverse=True):
        if not any(d.iterdir()):
            d.rmdir()

    items.sort(key=lambda i: (i['category'], i['title'].lower()))
    # La date ne change que si le contenu change : pas de commit inutile chaque jour.
    generated = old.get('generated_at') if items == old.get('items') else datetime.now(timezone.utc).isoformat(timespec='seconds')
    MANIFEST.write_text(json.dumps(
        {'generated_at': generated, 'root': ROOT_ID, 'items': items},
        ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(items)} fichiers synchronisés.')


if __name__ == '__main__':
    sys.exit(main())
