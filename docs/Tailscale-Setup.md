# Tailscale VPN Setup Guide

This guide covers the complete setup of Tailscale VPN for connecting your dev containers to private DigitalOcean resources (databases, Kubernetes clusters, Redis, etc.) through a secure VPN tunnel with SOCKS5 proxy support.

## Overview

The setup involves three main components:

1. **DigitalOcean Infrastructure** - A gateway droplet that acts as a subnet router
2. **Tailscale Admin Console** - Configuration of routes and authentication keys
3. **Dev Container Client** - Installation and configuration in your development environment

---

## Part 1: DigitalOcean Infrastructure Setup

You need one Droplet inside your DigitalOcean VPC to act as the **Subnet Router**. This Droplet will receive traffic from your dev containers and forward it to your private resources (Databases, K8s Clusters, Redis, etc.).

### 1. Identify your VPC Subnet

1. Log in to DigitalOcean.
2. Go to **Networking** → **VPC**.
3. Note the IP Range of your VPC (e.g., `10.10.0.0/16` or `10.124.0.0/20`). *You will need this later.*

### 2. Create or Configure the Gateway Droplet

You can use an existing bastion host or create a small, cheap Droplet (e.g., $6/mo) for this purpose.

* **OS:** Ubuntu 22.04 or 24.04 (recommended).
* **Network:** Ensure it is assigned to the VPC you identified above.

### 3. Configure the Droplet as a Router

SSH into the Gateway Droplet and run the following:

#### A. Enable IP Forwarding

Linux defaults to dropping packets not meant for itself. You must enable forwarding.

```bash
# Clear and enable IP forwarding
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
```

#### B. Install Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

#### C. Start Tailscale & Advertise Routes

Replace `10.124.0.0/20` with **your specific VPC Subnet** found in step 1.

```bash
# This authenticates the machine and tells Tailscale "I can route traffic to 10.124.x.x"
sudo tailscale up --advertise-routes=10.124.0.0/20 --ssh
```

---

## Part 2: Tailscale Admin Console Setup

1. Go to the [Tailscale Admin Console](https://login.tailscale.com/admin/machines).

2. **Approve the Subnet Routes:**
   * Find your Gateway Droplet in the list.
   * Click the **"..."** menu → **Edit route settings**.
   * Toggle the switch for `10.124.0.0/20` (or whatever your subnet is) to **On**.

3. **Disable Key Expiration (for the Gateway):**
   * Click the **"..."** menu on the Gateway Droplet → **Disable key expiration**. (You don't want your infrastructure disconnecting every 6 months).

4. **Generate the Key for your Developers:**
   * Go to **Settings** → **Keys** → **Generate auth key**.
   * **Reusable:** On.
   * **Ephemeral:** On (Critical for containers—cleans up old devices automatically).
   * **Tags:** Create a tag like `tag:devs`.
   * *Copy this key. Your developers will paste this when they run the script.*

### Understanding Reusable and Ephemeral Keys

It is easy to get the terminology mixed up because "Ephemeral" usually means "short-lived," but in Tailscale, it refers to the **device**, not the key.

Here is exactly how the "One Key, Many Devs" setup works:

#### 1. The Key is "Reusable"

When you generate the key in the Tailscale dashboard, you must toggle the **Reusable** setting to "On".

* This turns the key into a "Factory Master Key."
* You give this **single key string** to all 50 of your developers.
* Developer A uses it. Developer B uses it. It works for everyone because it is **Reusable**.

#### 2. The *Nodes* are "Ephemeral"

When you generate that same key, you also toggle the **Ephemeral** setting to "On".

* This tells Tailscale: "Any device created with this key is temporary."
* When your developer shuts down their container (stops VS Code), the connection drops.
* Because it was tagged as Ephemeral, Tailscale **automatically deletes that device from your Admin Console** immediately (or after a very short timeout).

#### Why this is critical for Dev Containers

Without the **Ephemeral** flag, every time a developer rebuilt their container (which happens a lot in Docker), your Tailscale dashboard would look like this:

* `dev-john` (offline)
* `dev-john-1` (offline)
* `dev-john-2` (offline)
* `dev-john-3` (active)

With the **Ephemeral** flag, the moment the old container dies, the entry is deleted. When the new one starts, it registers fresh. Your dashboard stays clean.

#### Summary of Settings

When you generate the key in the console, ensure you have these **exact** settings:

| Setting | Value | Why? |
|---------|-------|------|
| **Reusable** | **ON** | So one key string works for your whole team (or multiple rebuilds). |
| **Ephemeral** | **ON** | So dead containers automatically disappear from your dashboard. |
| **Tags** | `tag:devs` | **Crucial.** This applies your ACLs automatically so you don't have to approve devices manually. |

#### Does the Key expire?

**Yes.** The "Reusable" key itself usually expires in 90 days (by default).

* **What happens then?** The container will start normally, but Tailscale will fail to authenticate, leaving you without VPN connectivity to your private resources.
* **The Fix:** You generate a new key, and your devs can update it without restarting the container:

```bash
update-tailscale-key
```

This script will:

* Prompt for the new auth key (input is hidden)
* Update the stored key in `.runtime/env-vars.sh`
* Re-authenticate the Tailscale daemon immediately
* No container restart required!

Alternatively, for first-time setup or complete reinstallation, run `install-extras tailscale` to go through the full setup process again.

---

## Part 3: Dev Container Setup

The devenv repository includes a Tailscale installation script at `.devcontainer/install-extras/tailscale.sh`.

### Prerequisites

* A Tailscale auth key from Part 2, step 4 above.
* A unique hostname for your dev container (e.g., `dev-john`, `backend-dev-1`).

### Running the Installation

The recommended way to install Tailscale (or any optional tool) is using the `install-extras` script:

```bash
install-extras tailscale
```

This command will:

* Find the Tailscale installation script in `.devcontainer/install-extras/`
* Display a preview of the script (if you have `bat` or `fzf` installed)
* Execute the installation automatically

Alternatively, you can run the interactive menu to see all available extras:

```bash
install-extras
```

The script will:

1. Install Tailscale if not already present
2. Prompt for your auth key (input is hidden for security)
3. Prompt for a hostname for your container
4. Configure SOCKS5 proxy environment variables
5. Register startup commands to reconnect Tailscale on container restart
6. Start Tailscale immediately

### What Gets Configured

#### Environment Variables

The script configures the following proxy variables in `.runtime/env-vars.sh`:

```bash
ALL_PROXY=socks5://localhost:1055
HTTP_PROXY=socks5://localhost:1055
HTTPS_PROXY=socks5://localhost:1055
NO_PROXY=localhost,127.0.0.1,::1,172.16.0.0/12,192.168.0.0/16,.local
TS_AUTHKEY=<your-auth-key>
```

#### Startup Commands

The script registers commands in `.devcontainer/custom_startup.sh` to:

* Ensure the Tailscale state directory exists
* Start the Tailscale daemon with userspace networking
* Configure SOCKS5 proxy on port 1055
* Authenticate with your auth key and hostname
* Accept advertised routes from the gateway droplet

## Part 4: Verification

After running the installation script, verify that Tailscale is working correctly:

### 1. Check Tailscale Status

```bash
tailscale status
```

You should see your gateway droplet listed as a peer.

### 2. Verify Proxy Environment Variables

```bash
env | grep PROXY
```

Expected output:

```text
ALL_PROXY=socks5://localhost:1055
HTTP_PROXY=socks5://localhost:1055
HTTPS_PROXY=socks5://localhost:1055
NO_PROXY=localhost,127.0.0.1,::1,172.16.0.0/12,192.168.0.0/16,.local
```

### 3. Test Internal Resource Access

Find the internal IP of a database or service in DigitalOcean (e.g., `10.124.16.5`).

```bash
# Test HTTP connectivity
curl -v http://10.124.16.5

# Test port connectivity
nc -zv 10.124.16.5 5432  # PostgreSQL example
```

**Note:** Do not use `ping` to test connectivity; ICMP packets may not route correctly through the SOCKS5 proxy. Use TCP-based tools like `curl`, `nc`, or `telnet` instead.

### 4. Test Internet Access

```bash
curl -I https://google.com
```

Should return HTTP 200.

### 5. Test Localhost Bypass

Verify that localhost traffic doesn't go through the proxy (important for local services):

```bash
# Start a simple HTTP server
python3 -m http.server 8000 &

# Test localhost access (should work immediately)
curl localhost:8000

# Kill the test server
kill %1
```

---

## Troubleshooting

### Tailscale won't connect

* **Check auth key:** Ensure your auth key is valid and hasn't expired.
* **Check routes:** Verify that subnet routes are approved in the Tailscale Admin Console.
* **Check firewall:** Ensure the gateway droplet allows UDP port 41641 (Tailscale's WireGuard port).

### Can't reach internal resources

* **Verify routes:** Run `tailscale status` and confirm the gateway is advertising routes.
* **Check `--accept-routes`:** The dev container must have `--accept-routes` enabled (the script does this automatically).
* **Test from gateway:** SSH to the gateway droplet and verify you can reach the internal resource from there.

### Proxy interferes with local services

* **Check `NO_PROXY`:** Ensure `NO_PROXY` includes `localhost,127.0.0.1` and your local network ranges.
* **Update if needed:**

  ```bash
   "$DEVENV_TOOLS/devenv-add-env-vars.sh" "NO_PROXY=localhost,127.0.0.1,::1,172.16.0.0/12,192.168.0.0/16,.local"
  ```

### Container restart loses connection

* **Check startup commands:** Verify `.devcontainer/custom_startup.sh` contains the Tailscale startup logic.
* **Manual restart:** Run `. ~/.devcontainer/custom_startup.sh` to reconnect without restarting the container.

---

## Security Considerations

* **Auth Keys:** Treat Tailscale auth keys like passwords. Never commit them to version control.
* **Ephemeral Keys:** Use ephemeral keys for dev containers to automatically clean up old devices.
* **Tags:** Use Tailscale tags to control access via ACLs (e.g., `tag:devs` can only access specific resources).
* **Key Rotation:** Rotate auth keys periodically and disable old keys in the Tailscale Admin Console.

---

## Additional Resources

* [Tailscale Documentation](https://tailscale.com/kb/)
* [Subnet Routers Guide](https://tailscale.com/kb/1019/subnets/)
* [DigitalOcean VPC Documentation](https://docs.digitalocean.com/products/networking/vpc/)
