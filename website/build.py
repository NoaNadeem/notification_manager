"""Build the public GitHub Pages site without dependencies or private data."""
from pathlib import Path
import html
import re
import shutil

root = Path(__file__).resolve().parent.parent
out = root / 'website/public'
out.mkdir(exist_ok=True)

def document(title, body, description):
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="google-site-verification" content="mrBBhHex5GeOYQMQz_U6K-GMrt7A_SNl7lJ9VkOSQeY">
<title>{html.escape(title)}</title><meta name="description" content="{html.escape(description)}">
<link rel="icon" href="icon.png"><link rel="stylesheet" href="styles.css"></head>
<body><header><a class="brand" href="./"><img src="icon.png" width="40" height="40" alt="">Notification Manager</a><nav aria-label="Main navigation"><a href="./">About</a><a href="privacy.html">Privacy</a><a href="mailto:noagoesplaces@gmail.com">Contact</a></nav></header>
<main>{body}</main><footer>Developed by Noa Nadeem · <a href="mailto:noagoesplaces@gmail.com">noagoesplaces@gmail.com</a> · <a href="https://github.com/NoaNadeem/notification_manager">Source code</a></footer></body></html>'''

home = '''<section class="intro"><p class="eyebrow">Google Calendar &amp; Google Tasks</p><h1>A dedicated window for what needs your attention.</h1><p class="lead">Notification Manager helps you review and organize past and upcoming events from your primary Google Calendar and your Google Tasks, with an optional Android companion.</p><a class="button" href="mailto:noagoesplaces@gmail.com?subject=Notification%20Manager%20access%20request">Request access by email</a><p class="availability">The Chrome extension is being prepared for Chrome Web Store release. Google access is currently limited to approved testers while OAuth verification is prepared.</p></section>
<section><h2>Review, prioritize, and reschedule</h2><ul><li>Search and filter Calendar events and Tasks.</li><li>Move items to another date and mark eligible titles as priorities.</li><li>Dismiss items with Undo and synchronize dismissal and recent-move history between installations connected to the same Google account.</li></ul></section>
<section><h2>Your account, your choice</h2><p>Choose which Google account to connect and authorize access through Google. The extension reads Calendar and Task data to display your items. Actions you select can change Calendar event times or eligible titles and Google Task dates, titles, or completion status.</p><p>Calendar dismissal hides an event in Notification Manager without deleting the event. Task dismissal marks a Task complete in Google Tasks. Undo delays and background retries can save selected actions later.</p><p>The extension communicates directly with Google's APIs. It uses its own Google Drive app-data folder for synchronization and has no developer-operated backend receiving your Calendar or Task content.</p><p><a href="privacy.html">Read the privacy policy</a> for details about access, storage, sharing, retention, and revocation.</p></section>
<section><h2>Access and support</h2><p>Email <a href="mailto:noagoesplaces@gmail.com">noagoesplaces@gmail.com</a> for help or to request access. Include the Google account email you want approved. Never send passwords, access tokens, or private Calendar content.</p><p>You can revoke authorization through <a href="https://myaccount.google.com/connections">Google Account connections</a>. Notification Manager is an independent project by Noa Nadeem.</p></section>'''
(out / 'index.html').write_text(document('Notification Manager', home, 'Review and organize your primary Google Calendar and Google Tasks in a dedicated Chrome window.'), encoding='utf-8')

def inline(text):
    return re.sub(r'\[([^\]]+)\]\((https://[^)]+)\)', r'<a href="\2">\1</a>', html.escape(text))

parts = []
for paragraph in (root / 'PRIVACY.md').read_text().strip().split('\n\n'):
    if paragraph.startswith('# '): parts.append('<h1>' + inline(paragraph[2:]) + '</h1>')
    elif paragraph.startswith('## '): parts.append('<h2>' + inline(paragraph[3:]) + '</h2>')
    else: parts.append('<p>' + inline(paragraph.replace('\n', ' ')) + '</p>')
(out / 'privacy.html').write_text(document('Notification Manager Privacy Policy', '\n'.join(parts), 'How the Notification Manager Chrome extension handles Google Calendar, Tasks, and app-data synchronization records.'), encoding='utf-8')
shutil.copyfile(root / 'chrome-extension/icons/icon128.png', out / 'icon.png')
(out / '.nojekyll').touch()
print('Built homepage and privacy policy from current source.')
