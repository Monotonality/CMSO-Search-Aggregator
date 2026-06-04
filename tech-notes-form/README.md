# Tech Notes Form

Standalone HTML tool (not part of CMSO Signal). Converts plain-text ticket notes into an editable form and back to `.txt`.

## Open

Double-click `index.html` or:

```powershell
start tech-notes-form\index.html
```

## Use

1. Under **Note templates**, pick a layout and **Copy** (for Notepad), **Load** (into import), or **Load & parse** (straight to form).
2. Or **paste** your own notes (`Label: value`, label block layout, `(empty)` placeholders).
3. Click **Parse into form** if you only loaded text without parsing.
4. Edit labels and values. **Add field** or remove with ×.
5. Choose export format, **Copy text** or **Download .txt**.

**Merge from paste** adds or updates fields without clearing the current form.

## Examples that parse

```
Client Name: John Doe
Client Agency: Fallburn PD
```

```
Customer Name: (empty)
Precinct: 142A
Location: OK
```

```
TICKET ID:

INC12345
REASON FOR TICKET:

No power on M500
```

Draft is saved in browser `localStorage`.

## Theme

Header **Theme** dropdown: **Dark**, **Light**, **System** (follows OS), **Ocean**, **Warm**. Choice is remembered in `localStorage`.
