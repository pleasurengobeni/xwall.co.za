Place your SSL certificate and private key here:

  nginx/ssl/cert.pem   — full-chain certificate (leaf + intermediates)
  nginx/ssl/key.pem    — RSA/ECDSA private key

These files are gitignored and must never be committed.

────────────────────────────────────────────────────────────
Production (Let's Encrypt via Certbot)
────────────────────────────────────────────────────────────
  sudo certbot certonly --standalone -d xwall.co.za -d www.xwall.co.za

  Then copy:
    sudo cp /etc/letsencrypt/live/xwall.co.za/fullchain.pem nginx/ssl/cert.pem
    sudo cp /etc/letsencrypt/live/xwall.co.za/privkey.pem  nginx/ssl/key.pem
    sudo chown $(whoami) nginx/ssl/*.pem

────────────────────────────────────────────────────────────
Local / CI self-signed certificate
────────────────────────────────────────────────────────────
  openssl req -x509 -newkey rsa:4096 \
    -keyout nginx/ssl/key.pem \
    -out    nginx/ssl/cert.pem \
    -days   365 -nodes \
    -subj   "/CN=localhost"

Remember to renew Let's Encrypt certs before they expire (90-day validity).
Add a cron job: 0 3 * * * certbot renew --quiet && docker compose restart nginx
