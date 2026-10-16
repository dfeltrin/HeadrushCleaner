# HeadRush Cleaner

Node.js utility for finding IRs, Amp Clones, and NAM models that are not referenced by any rig or by presets saved in `Blocks`.

**Status: experimental.** Compatibility with all devices, firmware versions, and rig/preset formats is not guaranteed. New formats may require updates to the dependency parser.

This is an independent project, not affiliated with, endorsed by, or supported by HeadRush. All trademarks mentioned belong to their respective owners.

All rigs and presets are preserved. Deleting unused resources requires separate confirmation for each category and is permanent, with no automatic backup.

## Before you begin

**Create a complete manual backup of the device's contents and verify that the copy is readable before using the utility.** Keep the backup in a separate folder from the one you intend to clean.

For an initial trial, use `--data` with a working copy of the device's contents, separate from the backup. Review the candidate list before confirming each category: reply `n` or press Enter to skip it. Automatic checks cover references recognized by the parser and do not replace a backup.

## Requirements and installation

Requires Node.js 22 or later and read/write access to the device folder. No npm packages or Docker are required: there is no need to run `npm install`.

```sh
git clone https://github.com/dfeltrin/HeadrushCleaner.git
cd HeadrushCleaner
node --version
```

## Quick start

Connect your HeadRush via USB and make sure the volume is mounted. On macOS, if the volume is named `HeadRush`, run:

```sh
./start.sh --data /Volumes/HeadRush
```

Alternatively, use Node.js or npm directly; adjust the path to match your device and use quotation marks if it contains spaces:

```sh
node cleaner.js --data "/path/to/device"
npm start -- --data "/path/to/device"
```

The path must point to the folder containing the libraries, not to an individual subfolder:

| Folder | Contents analyzed | Required |
| --- | --- | --- |
| `Rigs` | JSON `.rig` files and their references | Yes |
| `Impulse Responses` | `.wav` resources | Yes |
| `Amp Clones` | `.ac` resources | Yes |
| `Neural Amp Modeler` | `.nam` resources | No |
| `Blocks` | Every file is parsed as a JSON preset, regardless of extension | No |

These top-level folder names and resource file extensions are matched case-insensitively. Scans include subfolders. Hidden files and folders are skipped in resource libraries, but included when scanning rigs and `Blocks`; `.DS_Store` and files beginning with `._` are always ignored.

Each `.rig` file must contain a JSON object with a `content` field that is either an object or a JSON string decoding to an object. Each file in `Blocks` must contain a JSON object: if it has `content`, the same rule applies; otherwise, the whole object is scanned for references. A non-JSON file in `Blocks` stops the analysis, even if its extension is not `.json`.

### Default path

Without `--data`, the utility looks for `HeadRush` in the project folder. The local symbolic link is not included in the repository. On macOS or Linux, you can create it after cloning:

```sh
ln -s /Volumes/HeadRush HeadRush
./start.sh
```

Once the link is configured, `npm start` also works. The `start.sh` script also works when called from another directory. To see the available syntax:

```sh
node cleaner.js --help
```

### Command-line options

| Option | Behavior |
| --- | --- |
| `--data FOLDER` | Use the specified device root or working copy. Relative paths are resolved from the current working directory; `start.sh` first changes to the project folder. |
| `--help` | Print usage information and exit without scanning the device. |

Console messages, help, and confirmation prompts are currently in Italian. There are no separate list/delete modes, automatic confirmation flags, backup options, or language options.

## Plan and confirmations

There is a single workflow: first, the complete plan is displayed, grouped into Impulse Responses, Amp Clones, and Neural Amp Modeler (`.nam`), with a list and count of candidate files. Then, for each non-empty category, the utility asks in Italian: `vuoi cancellare definitivamente N file? [s/N]` ("Do you want to permanently delete N files?").

Reply `s`, `si`, or `sì` to delete, or `n`, `no`, or Enter to skip the category. Answers ignore surrounding whitespace and letter case. Other answers, including `y` and `yes`, repeat the prompt without authorizing deletion. When input ends, the operation stops without any further deletions. Categories with no candidates are shown as having 0 files and skipped. If the initial plan has no candidates at all, the utility exits immediately.

All rigs are preserved and protect the resources they use. Setlists are not read and are not required. The plan for IRs, Amp Clones, and NAM models is recalculated and displayed before the respective confirmation.

To display the initial plan without deleting anything, run the utility and decline every category. On macOS or Linux, you can also end input immediately:

```sh
node cleaner.js --data "/path/to/device" < /dev/null
```

The initial plan lists candidate paths and file counts, not disk-space estimates. Candidate contents are hashed only when their category is reached, so generating the initial plan does not read every unused model in full.

## Deletion

Deletion is permanent: files are removed directly, with no backup, Trash, or undo.

Do not modify rigs or presets or disconnect the device during the operation. After a category is confirmed, the utility scans dependencies again and checks that its candidate list has not changed. It compares candidate contents against their SHA-256 fingerprints and rechecks the fingerprints of the rig and preset bytes read during that final scan before deleting any files in the category.

Immediately before each removal, the candidate's resolved path and contents are checked again. Dependencies are not rescanned between individual removals. If removal or subsequent empty-folder cleanup fails, execution stops and reports the number of files already deleted in that category; those files are not restored. Completed deletions in earlier categories are also retained. The utility does not hold an exclusive filesystem lock, and the operation is not an atomic transaction.

## Checks

- Malformed JSON, invalid `content`, missing or ambiguous library folders, and symbolic links encountered in scanned locations stop the analysis. The device root itself may be a symbolic link; library folders must be ordinary directories. Excluded hidden resource entries and protected folders are not traversed.
- References are extracted from string values in JSON, including fields outside `content`, nested objects and arrays, and serialized JSON strings such as scenes. Excessive nesting or malformed strings recognized as nested JSON stop the analysis. This is string matching, not complete validation of every device-specific rig or preset schema.
- A reference containing a library folder name, such as `Impulse Responses/A/Cab.wav`, must match the path within that library, with or without the extension. References without a library folder name also match by filename or filename without extension, preserving all matches even if the reference includes a different parent path. For example, `Cab` protects every `Cab.wav` in the IR library.
- References are compared case-insensitively with Unicode NFC normalization, backslash-to-slash conversion, and path normalization. Percent-encoded sequences are considered both literally and decoded, preserving both matches in ambiguous cases. Future formats that encode dependencies differently require a parser update.
- `Impulse Responses/HeadRush`, `Impulse Responses/Choptones`, and `Amp Clones/HeadRush` are excluded from scanning and deletion, with case-insensitive matching of these immediate child names. The top-level library folders are not deleted.
- Empty non-hidden subfolders in a category are cleaned up only after that category successfully deletes at least one file. This can also remove folders that were already empty. Hidden files and macOS metadata are preserved, so folders containing them remain.
- Presets in `Blocks` are always preserved and protect all their recognized dependencies, even if they are not used in rigs. Resources referenced by any rig remain protected regardless of setlist membership or references between rigs.
- Before deleting IRs, Amp Clones, or NAM models, verification considers all rigs on the device.
- The Neural Amp Modeler category recursively searches for `.nam` files in the device's `Neural Amp Modeler` folder, preserving referenced files and all files with other extensions. If the folder is absent, the category shows 0 files. SuperClones is not cleaned. The binary `.ac` and `.sc` formats are not interpreted as containers of additional dependencies: protection covers references recognized in rig and preset JSON, not any references inside opaque formats.

## Docker

As an alternative to installing Node.js locally, you can use Docker with Compose. Run from the project folder:

```sh
docker compose run --rm cleaner
```

It uses the same interactive workflow and mounts `/Volumes/HeadRush` by default. To specify a different path on macOS or Linux:

```sh
HEADRUSH_PATH="/path/to/device" docker compose run --rm cleaner
```

The device is mounted with read/write access, and the path must already exist and be accessible to Docker. There is no need to run Docker with `sudo` or install dependencies in the container.

## Project verification

```sh
npm test
```

The tests use temporary folders and do not require a connected device. They check confirmations, dependency preservation, handling of changes during analysis, and stopping on errors.

Passing the tests does not certify compatibility with every device or firmware version.

## Troubleshooting

- **HeadRush folder inaccessible:** check the USB connection, volume mount, and `--data` path. After a fresh clone, use an explicit path or create the `HeadRush` link described above.
- **Missing or ambiguous folder:** make sure `--data` points to the device's root folder and that it contains the three required libraries, with no duplicates differing only in letter case.
- **Unreadable JSON or unrecognized content:** check the file identified in the error. The utility stops the analysis if it cannot interpret rigs or presets.
- **Dependencies changed or file modified:** stop making changes to the device and run the utility again to obtain an updated plan.
- **Operation interrupted during deletion:** read the count of files already deleted in the error message; those files are not restored.
