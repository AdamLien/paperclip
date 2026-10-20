#!/bin/sh
set -eu
# The old self-hosted backend trusts loopback. Only the dedicated gateway UID
# and the backend's own service cgroup may reach the private port. The legacy
# server performs a self-request during startup. Do not let agent/SSH processes bypass
# the authenticated front. External hosts may not reach the backend either.
rule_output() { /usr/sbin/iptables -w "$1" OUTPUT -p tcp --dport 6770 -m owner --uid-owner 1000 -m cgroup ! --path user.slice/user-1000.slice/user@1000.service/app.slice/supermemory.service -m comment --comment crew-memory-private-backend -j REJECT; }
rule_input() { /usr/sbin/iptables -w "$1" INPUT ! -i lo -p tcp --dport 6770 -m comment --comment crew-memory-private-backend -j REJECT; }
case "${1:-start}" in
  start)
    rule_output -C 2>/dev/null || rule_output -I
    rule_input -C 2>/dev/null || rule_input -I
    ;;
  stop)
    rule_output -C 2>/dev/null && rule_output -D || true
    rule_input -C 2>/dev/null && rule_input -D || true
    ;;
  *) exit 64 ;;
esac
