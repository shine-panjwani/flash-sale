#!/bin/bash
# ==============================================================================
# OS Tuning Script for AWS EC2 (m7i.large)
# Run once on the box before tests: sudo bash tune.sh
# ==============================================================================

set -e

echo "Applying kernel and socket optimizations for 50,000+ req/s..."

# 1. Increase File Descriptors Limit
ulimit -n 65535
sysctl -w fs.file-max=2097152

# 2. Socket Queue and Backlog Limits
sysctl -w net.core.somaxconn=65535
sysctl -w net.ipv4.tcp_max_syn_backlog=65535

# 3. Fast TCP Connection Recycling & Timeouts
sysctl -w net.ipv4.tcp_tw_reuse=1
sysctl -w net.ipv4.tcp_fin_timeout=15

# 4. Ephemeral Port Range Expansion
sysctl -w net.ipv4.ip_local_port_range="1024 65535"

# 5. TCP Memory Buffers
sysctl -w net.ipv4.tcp_rmem="4096 87380 16777216"
sysctl -w net.ipv4.tcp_wmem="4096 65536 16777216"

echo "✅ OS tuning applied successfully!"
