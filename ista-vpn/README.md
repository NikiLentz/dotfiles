# ISTA VPN VM helper

This controls the existing `ista-vpn` libvirt Windows VM. Nothing autostarts.

- `ista-vpn connect` starts both libvirt networks, resumes Windows, opens the
  viewer, and shows the COSMIC indicator.
- After FortiClient connects, the indicator installs only the routes advertised
  by the ISTA tunnel.
- The indicator enables `ISTA VDMA PROD` and `ISTA VDMA STAGING` Remmina entries
  only while the tunnel is connected. Local-drive sharing is disabled.
- `ista-vpn disconnect` suspends Windows with managed-save, removes the routes,
  and stops the dedicated network.

The RDP profiles contain no password. Remmina stores it in the desktop keyring;
after restoring these dotfiles on another computer, enter and save it once in
each profile.

The Windows VM and its FortiClient/OpenSSH setup are intentionally not rebuilt
by the dotfiles installer. The VM disk contains that state.
