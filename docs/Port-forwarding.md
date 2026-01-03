# Port Forwarding

This document explains how to access services running in remote environments from your local development machine using port forwarding.

## What Is Port Forwarding?

Port forwarding creates a temporary tunnel between your local machine and a remote service. It allows you to:

- Access remote services as if they were running locally
- Debug services running in production-like environments
- Test integrations with remote dependencies
- Inspect and troubleshoot remote applications

When you set up port forwarding:
> "Any traffic sent to port **XXXX** on my local machine gets forwarded to port **YYYY** on the remote service."

## Why Use Port Forwarding?

The primary use case is **debugging services in specific environments**. For example:

- A service is behaving differently in staging than in local development
- You need to debug using production data
- You want to test against real dependencies without deploying
- You need to inspect the actual state of a running service

## SSH Port Forwarding

The most common way to forward ports is using SSH tunnels.

### Basic SSH Tunnel

Forward a remote port to your local machine:

```bash
ssh -L <local-port>:localhost:<remote-port> user@remote-host
```

**Example:**
```bash
# Forward remote port 5000 to local port 8080
ssh -L 8080:localhost:5000 user@prod-server.example.com
```

Now you can access `http://localhost:8080` and it will connect to port 5000 on the remote server.

### Background SSH Tunnel

Run the tunnel in the background:

```bash
ssh -fN -L <local-port>:localhost:<remote-port> user@remote-host
```

Options:
- `-f`: Fork to background after authentication
- `-N`: Don't execute remote commands (just forward ports)

**Example:**
```bash
ssh -fN -L 5432:localhost:5432 user@db-server.example.com
```

### Multiple Port Forwarding

Forward multiple ports in one SSH session:

```bash
ssh -L 8080:localhost:80 \
    -L 5432:localhost:5432 \
    -L 6379:localhost:6379 \
    user@remote-host
```

### Reverse SSH Tunnel

Allow remote server to access your local service:

```bash
ssh -R <remote-port>:localhost:<local-port> user@remote-host
```

**Example:**
```bash
# Let remote server access your local web server on port 3000
ssh -R 8080:localhost:3000 user@remote-host
```

## Docker Port Forwarding

When working with containerized services, you can expose container ports to your local machine.

### Docker Run with Port Mapping

```bash
docker run -p <local-port>:<container-port> image-name
```

**Example:**
```bash
# Map container port 80 to local port 8080
docker run -p 8080:80 nginx
```

### Docker Compose Port Mapping

In `docker-compose.yml`:

```yaml
services:
  web:
    image: nginx
    ports:
      - "8080:80"
      - "4443:443"
```

## VS Code Remote Port Forwarding

When using VS Code with remote development, you can forward ports through the editor.

### Automatic Port Detection

VS Code automatically detects ports opened in the remote terminal and offers to forward them.

### Manual Port Forwarding

1. Open Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Type "Forward a Port"
3. Enter the port number
4. Access via `http://localhost:<port>`

### Configure in devcontainer.json

```json
{
  "forwardPorts": [3000, 5000, 8080],
  "portsAttributes": {
    "3000": {
      "label": "Web Server",
      "onAutoForward": "notify"
    }
  }
}
```

## Common Port Forwarding Scenarios

### Database Access

Forward a remote database port:

```bash
# PostgreSQL
ssh -L 5432:localhost:5432 user@db-server

# MySQL
ssh -L 3306:localhost:3306 user@db-server

# MongoDB
ssh -L 27017:localhost:27017 user@db-server
```

### API Debugging

Forward an API service:

```bash
# Forward remote API to local port
ssh -L 5000:localhost:5000 user@api-server

# Now you can call: curl http://localhost:5000/api/endpoint
```

### Web Application

Forward a web server:

```bash
ssh -L 8080:localhost:80 user@web-server

# Access at: http://localhost:8080
```

### Multiple Services

Forward an entire stack:

```bash
ssh -L 3000:localhost:3000 \
    -L 5000:localhost:5000 \
    -L 5432:localhost:5432 \
    -L 6379:localhost:6379 \
    user@remote-host

# 3000: Frontend
# 5000: Backend API
# 5432: PostgreSQL
# 6379: Redis
```

## Troubleshooting

### Port Already in Use

If you get "port already in use" errors:

```bash
# Find what's using the port
lsof -i :<port>

# Kill the process
kill <PID>
```

### Connection Refused

If you can't connect:

1. Verify the remote service is running: `ssh user@remote-host "netstat -tlnp | grep <port>"`
2. Check firewall rules
3. Verify SSH connection works
4. Try binding to 127.0.0.1 explicitly: `-L 127.0.0.1:8080:localhost:80`

### SSH Tunnel Closes

Keep tunnels alive with:

```bash
ssh -o ServerAliveInterval=60 -L 8080:localhost:80 user@remote-host
```

Or configure in `~/.ssh/config`:

```
Host remote-host
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

## Security Considerations

1. **Use SSH keys**: Don't use passwords for tunnels
2. **Bind to localhost**: Use `127.0.0.1` to prevent external access
3. **Close unused tunnels**: Don't leave tunnels running when not in use
4. **Audit forwarded ports**: Know what's exposed
5. **Use VPN when available**: VPN is often better than port forwarding for production access

## Best Practices

1. **Document your tunnels**: Keep track of what ports are forwarded and why
2. **Use consistent port numbers**: Use the same local ports across projects
3. **Clean up**: Close tunnels when done
4. **Use automation**: Create scripts for common forwarding scenarios
5. **Prefer temporary tunnels**: Don't leave background tunnels running indefinitely

## Helper Scripts

Create reusable scripts for common scenarios:

```bash
#!/bin/bash
# forward-staging.sh - Forward all staging services

ssh -fN \
    -L 3000:localhost:3000 \
    -L 5000:localhost:5000 \
    -L 5432:localhost:5432 \
    user@staging-server

echo "Staging services forwarded:"
echo "  Frontend: http://localhost:3000"
echo "  API: http://localhost:5000"
echo "  Database: localhost:5432"
```

## See Also

- [Dev Container Environment](./Dev-container-environment.md) - Dev container configuration
- [Additional Tooling](./Additional-Tooling.md) - Available development tools
- [Contributing](./Contributing.md) - Contributing guidelines
