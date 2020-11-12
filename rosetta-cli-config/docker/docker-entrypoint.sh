#!/usr/bin/env bash
# Use this script to enable host.docker.internal on Docker for linux.
# See https://github.com/bufferings/docker-access-host

HOST_DOMAIN="host.docker.internal"
ping -q -c1 $HOST_DOMAIN >/dev/null 2>&1
if [ $? -ne 0 ]; then
  HOST_IP=$(ip route | awk 'NR==1 {print $3}')
  echo -e "$HOST_IP\t$HOST_DOMAIN" >>/etc/hosts
fi

cat /etc/hosts
echo "patched host.docker.internal"

# wait for things to settle down
sleep 20

exec "$@"
