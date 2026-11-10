## wherdr 3 is coming: what 2.6 changes for you

2.6 is the last new version of wherdr 2. It gets you ready for wherdr 3, which installs **beside** wherdr 2 rather than replacing it.

- **Updates stay on wherdr 2.** The update check only offers 2.x versions. When wherdr 3 is published, the Update button never installs it, and wherdr 2 fixes (2.6.1, 2.6.2…) are still offered.
- **A "wherdr 3 is out" card.** Once wherdr 3 is released, Home shows a card instead of the update banner, with links to its release notes and its migration guide, and a Copy button for the command that installs wherdr 3 beside this version. That command shows its plan first and changes nothing until you add `--yes`. wherdr 2 keeps running with its data, so you can compare both and go back at any time.
- **Installs follow the 2.x branch.** The Herdr plugin now updates from the `2.x` branch (the update command adds `--ref 2.x`), and the curl installer installs `2.x` by default (`WHERDR_REF` still picks another branch or tag). If you run wherdr from a git checkout, switch it to the release branch once with `git checkout 2.x` before pulling; the update banner shows that command.

## Update

No migration is required from 2.5.0. Node.js 22 or newer and Herdr 0.9.1 or newer remain required.

[Full changelog](https://github.com/afloury/wherdr/blob/v2.6.0/CHANGELOG.md)
