# Hosting the on-device AI model

The app (fire.byteheaven.in) stays on GitHub Pages. Only the AI model files (~3.1 GB for Gemma 4 E2B) live on Cloudflare R2, served at `https://models.byteheaven.in/`. The page's security policy already allows that address and nothing else.

You do steps 1–5 once. After that, publishing or swapping a model is step 6 alone.

## 1. Create the R2 bucket
1. In the Cloudflare dashboard, open **R2 Object Storage** in the left menu.
   - The first time, R2 asks you to activate it and add a payment method. It stays free within the free tier: 10 GB storage, 10 million reads a month, and no charge for downloads.
2. Click **Create bucket**:
   - **Name:** `findmyfire-models` (any name works; you'll enter it as a secret later)
   - **Location:** Automatic, or a hint of *Asia-Pacific* since most users are in India
   - **Storage class:** Standard
3. Note your **Account ID**. It's shown on the R2 overview page under *Account details*, and in the dashboard URL.

## 2. Put the bucket on models.byteheaven.in
1. Open the bucket, then **Settings → Public access → Custom Domains → Connect Domain**.
2. Enter `models.byteheaven.in` and confirm. Cloudflare creates the DNS record itself, since byteheaven.in is in the same account.
3. Wait until the status shows **Active**, usually a minute or two.
4. Leave the **r2.dev subdomain** disabled. The app only uses the custom domain.

## 3. Allow the app to read it (CORS)
In the bucket, open **Settings → CORS Policy → Add CORS policy** and paste:

```json
[
  {
    "AllowedOrigins": ["https://fire.byteheaven.in", "http://localhost:8080"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "ETag"],
    "MaxAgeSeconds": 86400
  }
]
```

`localhost:8080` is only for trying it locally with `npm run serve`. Remove it if you prefer.

## 4. Create an upload key for GitHub
1. On the R2 overview page, open **Manage API tokens → Create API token** (an R2 token, not a general Cloudflare one).
2. Choose these settings:
   - **Permissions:** Object Read & Write
   - **Specify bucket:** only `findmyfire-models`
   - **TTL:** forever, or a date you'll remember to renew
3. Click **Create**. Copy the **Access Key ID** and **Secret Access Key** now; the secret is shown only once.

## 5. Add the secrets to GitHub
In the repo, open **Settings → Secrets and variables → Actions → New repository secret** and add four secrets:

| Name | Value |
|---|---|
| `R2_ACCOUNT_ID` | the Account ID from step 1 |
| `R2_ACCESS_KEY_ID` | from step 4 |
| `R2_SECRET_ACCESS_KEY` | from step 4 |
| `R2_BUCKET` | `findmyfire-models` |

The workflow also commits the updated model list to `main`. Check these two settings:
- **Settings → Actions → General → Workflow permissions** must allow *Read and write*.
- If `main` has branch protection, it must let GitHub Actions push.

## 6. Publish the model
1. Open **Actions → Publish AI model → Run workflow**, on branch `main`.
2. Leave the defaults:
   - repo `onnx-community/gemma-4-E2B-it-ONNX`
   - id `gemma4-e2b`
   - label `Standard`
   - name `Gemma 4 E2B`
3. Leave **cpu** and **browser** unticked, and tick **publish**. Then click **Run**.
4. It takes about 20–30 minutes:
   - fetch from Hugging Face and hash every 8 MB piece;
   - evaluate the model (the report appears in the run's *Summary*);
   - upload about 3.1 GB to R2;
   - commit `src/assistant/models.json` and start the site deploy.
5. Read the Summary before celebrating. The explanations table should look as good as in `README.md`.

## 7. Check it's live
Replace `abc1234` with the folder name in `src/assistant/models.json` (`"path": "gemma4-e2b/…"`).

```sh
# The file is there, and a byte range comes back as 206 with the CORS header
curl -sI https://models.byteheaven.in/gemma4-e2b/abc1234/config.json
curl -s -o /dev/null -D - -H "Origin: https://fire.byteheaven.in" -H "Range: bytes=0-99" \
  https://models.byteheaven.in/gemma4-e2b/abc1234/tokenizer.json | grep -iE "^HTTP|access-control-allow-origin|content-range"
```

Then open fire.byteheaven.in, load or enter a plan, and go to Results. Under *Ask about your plan*:
1. Press **Add AI**.
2. Refresh halfway through; the download should carry on.
3. Ask a question and check the "Written in X s" line.

Try it on a laptop and on your phone.

## 8. Protect the bucket (recommended)
The files are public on purpose, but a bot re-downloading them could use up the free read quota. One download is about 390 reads, so the free tier covers about 25,000 downloads a month.

1. **Rate limit:** open **byteheaven.in → Security → WAF → Rate limiting rules → Create rule**:
   - **If:** Hostname equals `models.byteheaven.in`
   - **Rate:** more than 150 requests per 10 seconds, per IP
   - **Action:** Block for 10 seconds

   A real user downloads at about 4 pieces a second, well below this.
2. **Billing alert:** open **Notifications → Add → Usage Based Billing** and set an alert for R2.

## Swapping models later
- Run step 6 with the new model's Hugging Face name and a new id. Read the evaluation Summary before ticking publish.
- Each model lives under its own `<id>/<commit>/` folder, so old files never change. Browsers delete pieces the model list no longer names the next time they download.
- Old folders can be deleted from the bucket once the new model is live.

## If something goes wrong
- **"The AI model hasn't been published yet":** `models.json` has no model yet. Check that the workflow's last step pushed a commit and that the site deploy after it succeeded.
- **The download fails straight away:** usually CORS. Re-check step 3, and that the custom domain is *Active*.
- **"didn't match its checksum":** a file on R2 differs from what was published. Re-run step 6.
- **"The AI couldn't start on this device":** the browser has no WebGPU, or the device ran out of memory. Plain answers keep working.
- **Changing the address:** if you'd rather not use `models.byteheaven.in`, the address appears in two places, the security policy in `index.html` and `base` in `src/assistant/models.json`. Both need changing together.
