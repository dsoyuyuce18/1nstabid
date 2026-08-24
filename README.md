# The Million Instagram Homepage

Bu proje, orijinal Million Dollar Homepage konseptinin sadece **Instagram** kullanıcılarına uyarlanmış, canlıya alınmaya hazır (production-ready) tam kapsamlı versiyonudur.

## Kurulum ve Çalıştırma

1. Bağımlılıkları yükleyin:
   `npm install`

2. Ortam değişkenlerini ayarlayın:
   `.env.example` dosyasını `.env` olarak kopyalayın ve Stripe anahtarlarınızı girin.

3. Uygulamayı başlatın:
   `npm start`

4. Tarayıcıda açın:
   `http://localhost:3000`

## Production deployment

This is an Express app, so deploy it as a Node web service. Set the service start command to `npm start` and configure these environment variables in the host dashboard:

- `BASE_URL`: `https://1nstabid.com`
- `STRIPE_SECRET_KEY`: your live Stripe secret key
- `STRIPE_WEBHOOK_SECRET`: the signing secret for the live webhook endpoint
- `PRICE_PER_PIXEL_CENTS`: `1`

The app exposes `GET /api/health` for service health checks. SQLite writes to `bids.db`, so production hosting must use a persistent volume or the database will be reset on redeploy.

For Stripe, create a live webhook for `https://1nstabid.com/api/payment/webhook` and enable the `checkout.session.completed` event.
