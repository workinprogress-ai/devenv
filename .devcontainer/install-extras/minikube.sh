#!/bin/bash

# sudo apt install -y \
#     helm conntrack ipset kubelet kubeadm nftables socat


arch=$(uname -m)
is_arm=$([ "$arch" == "aarch64" ] && echo 1)

mkdir -p $devenv/.installs
cd $devenv/.installs

if [ "$is_arm" == "1" ]; then
    if [ ! -f ./minikube.deb ]; then 
        curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube_latest_arm64.deb
        mv minikube_latest_arm64.deb minikube.deb
    fi
else
    if [ ! -f ./minikube.deb ]; then
        curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube_latest_amd64.deb
        mv minikube_latest_amd64.deb minikube.deb
    fi
fi
sudo apt install -y ./minikube.deb
cd - &>/dev/null