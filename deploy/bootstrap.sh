#!/usr/bin/env bash
# One-time (idempotent) setup of the MechDost server: Ubuntu 24.04 on AWS (docs/runbooks/deploy.md).
# Run as the `ubuntu` user:  bash bootstrap.sh
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  # Docker Engine + compose plugin from Docker's own apt repository (signed).
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker

# Docker logs rotate instead of filling the disk.
if [ ! -f /etc/docker/daemon.json ]; then
  echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }' | sudo tee /etc/docker/daemon.json >/dev/null
  sudo systemctl restart docker
fi

# 2 GB swap: the server has 1.9 GB of memory (images are built in GitHub Actions, not here).
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# Security updates install themselves.
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades >/dev/null
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

sudo install -d -o "$USER" -g "$USER" -m 0750 /opt/mechdost
echo "bootstrap done: docker $(docker --version | cut -d' ' -f3 | tr -d ,), swap $(swapon --show --noheadings | awk '{print $3}')"
