# Claude quota screen provenance

- `claude-limit-weekly.txt`: neutral excerpt of the user-supplied Claude Code screen,
  retaining the actual limit, reset link, live input and automatic-continuation footer.
- `claude-limit-session.txt`: neutral reconstruction using the installed Claude Code
  2.1.296 renderer. Its `toe` mapping names `five_hour` "session limit" and `seven_day`
  "weekly limit"; `Xw` renders those names through the same limit error formatter.
  `K0r` renders "Usage limit reached · limit resets …" and `ft.waiting` renders
  "Continuing automatically … · esc to cancel" for both windows. The time and
  timezone are fixture values, not a claim that a live account hit its 5-hour limit.

Recognition requires the live banner below the final input box. Scrollback errors,
Codex footer warnings and omp provider retry messages do not establish this state.
No authenticated agent was prompted, reconfigured or forced to exhaust its quota.
