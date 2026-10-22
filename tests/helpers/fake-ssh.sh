#!/bin/sh
# Stand-in for ssh in tests/sshReconnect.test.ts. Like OpenSSH, a master
# (-M -S path) removes its control path when it exits, whoever owns it now.
# A multiplexed session without a control socket fails as the real client
# does with ProxyCommand=/bin/false; "$FAKE_SSH_DIR/refuse" makes sshd refuse
# every session. Masters and sessions are logged in "$FAKE_SSH_DIR/log".
ctl= op= master= cmd=
while [ $# -gt 0 ]; do
  case "$1" in
    -M) master=1 ;;
    -S) shift; ctl=$1 ;;
    -O) shift; op=$1 ;;
    -o|-L) shift ;;
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
  forward) exit 0 ;;
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
  *'status server'*)
    printf 'home=/home/test\nhost=fakehost\nos=Linux\nbin=/opt/herdr\nstatus: running\nsocket: /tmp/fake-herdr.sock\n' ;;
  *) echo "session ok" >> "$FAKE_SSH_DIR/log"; echo ok ;;
esac
