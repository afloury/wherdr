#!/bin/sh
# Stand-in for ssh in tests/sshReconnect.test.ts. Like OpenSSH, a master
# (-M -S path) removes its control path when it exits, whoever owns it now.
# A multiplexed session without a control socket fails as the real client
# does with ProxyCommand=/bin/false; "$FAKE_SSH_DIR/refuse" makes sshd refuse
# every session. Masters and sessions are logged in "$FAKE_SSH_DIR/log".
ctl= op= master= cmd= fwd=
while [ $# -gt 0 ]; do
  case "$1" in
    -M) master=1 ;;
    -S) shift; ctl=$1 ;;
    -O) shift; op=$1 ;;
    -o) shift ;;
    -L) shift; fwd=$1 ;;
    --) shift; shift; cmd=$1; break ;;
  esac
  shift
done

if [ -n "$master" ]; then
  echo "master $ctl" >> "$FAKE_SSH_DIR/log"
  echo $$ > "$ctl"
  trap 'rm -f "$ctl"; exit 0' TERM INT
  while :; do sleep 1 & wait $!; done
fi

case "$op" in
  check)
    [ -e "$ctl" ] && { echo "Master running (pid=$(cat "$ctl"))" >&2; exit 0; }
    echo "Control socket connect($ctl): No such file or directory" >&2; exit 255 ;;
  forward)
    echo "forward $fwd" >> "$FAKE_SSH_DIR/log"
    exit 0 ;;
  exit)
    [ -e "$ctl" ] || exit 255
    kill "$(cat "$ctl")" && echo "Exit request sent." >&2; exit 0 ;;
esac

if [ ! -e "$ctl" ]; then
  echo "Connection closed by UNKNOWN port 65535" >&2; exit 255
fi
if [ -e "$FAKE_SSH_DIR/refuse" ]; then
  echo "session refused" >> "$FAKE_SSH_DIR/log"
  echo "mux_client_request_session: session request failed: Session open refused by peer" >&2; exit 255
fi
case "$cmd" in
  *'remote-api-bridge'*'--check'*)
    [ -e "$FAKE_SSH_DIR/no-bridge" ] && exit 2
    echo herdr-api-bridge-v1 ;;
  *'remote-api-bridge'*|*'remote-client-bridge'*)
    echo "bridge $cmd" >> "$FAKE_SSH_DIR/log"
    exec cat ;;
  *'status server'*)
    if [ -e "$FAKE_SSH_DIR/bad-shell" ]; then printf '\377\376' >&2; exit 1; fi
    if [ -e "$FAKE_SSH_DIR/windows" ]; then
      printf 'home=/c/Users/test\nhost=fakehost\nos=MINGW64_NT\nbin=/opt/herdr\nstatus: running\nsocket: C:\\Users\\test\\herdr.sock\n'
      exit 0
    fi
    printf 'home=/home/test\nhost=fakehost\nos=Linux\nbin=/opt/herdr\nstatus: running\nsocket: /tmp/fake-herdr.sock\n' ;;
  *) echo "session ok" >> "$FAKE_SSH_DIR/log"; echo ok ;;
esac
