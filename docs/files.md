# Files

[Documentation](README.md) · [Project](../README.md)

- **Browse files** (agent's **…** menu): a read-only browser of the agent's folder, confined to
  the Git root that holds it (or the folder itself). Every resolved path, symbolic links
  included, must stay under that root; nothing is ever written.
- **Preview** text and code (first 256 KB), images (up to 2 MB), PDFs and videos, and
  **download** any file up to 50 MB.
- **Paths in a conversation**: a file path an agent writes in its reply opens the same preview,
  with the machine's home folder as the root.
- **Remote agents**: on this machine the files are read from disk; on a core machine they are
  read with `machine.exec` on that machine, with the same scripts, and only while it is online.
  macOS may need "Allow full disk access for remote users" (System Settings › General › Sharing ›
  Remote Login) for some folders.

The **Changes** view (Git status and diff, line comments and **Send review**) and worktree
management are v2 only.
