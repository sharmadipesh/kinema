/**
 * Saving a file from the side panel.
 *
 * An object URL and a synthetic anchor click, rather than the `downloads`
 * permission. The permission would work and would also be a new install-time
 * capability on an extension that currently asks for none at install — for a
 * feature that saves a text file the user just asked for. The anchor needs no
 * permission at all.
 *
 * The URL is revoked on the next frame rather than immediately: Chrome starts
 * the download asynchronously after the click, and revoking in the same tick
 * cancels it. A timeout is the documented way round it and there is no event to
 * wait on.
 */
export function downloadFile(filename: string, mime: string, contents: string): boolean {
  try {
    const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeName(filename);
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * A filename that cannot escape its directory or confuse a shell.
 *
 * The stem comes from a user-supplied video title, which on a page video is
 * whatever the site put in the DOM — untrusted text, and the one place in this
 * feature where it reaches the filesystem.
 */
export function safeName(filename: string): string {
  const cleaned = filename
    .replace(/[/\\]+/g, '-')
    // Control characters are stripped by code point rather than by a regex
    // range: the literal range is easy to get subtly wrong and reads as noise.
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('')
    .replace(/[<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return (cleaned || 'kinema-export').slice(0, 120);
}

/** `2026-08-24` — stable in a filename and sortable in a folder. */
export function dateStamp(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * One CSV field.
 *
 * Quotes everything rather than deciding per value. A cut label is model-written
 * text that can contain a comma, a quote or a newline, and a CSV that is correct
 * only for the values seen in testing is the kind that corrupts a spreadsheet
 * six months later.
 */
export function csvField(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function csvRow(fields: Array<string | number>): string {
  return fields.map(csvField).join(',');
}
