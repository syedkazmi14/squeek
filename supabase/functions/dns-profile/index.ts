// GET -> a configuration profile that turns on Cloudflare's malware-blocking encrypted DNS
// (1.1.1.2, "security.cloudflare-dns.com") for the whole iPhone. Installing a profile needs no
// paid Apple developer capability, unlike setting DNS from inside the app.
// Opened from Clickey's setup guide in Safari; the person installs it in Settings.
// JWT verification is off for this function (see supabase/config.toml): Safari sends no token.

const PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>DNSSettings</key>
      <dict>
        <key>DNSProtocol</key>
        <string>HTTPS</string>
        <key>ServerURL</key>
        <string>https://security.cloudflare-dns.com/dns-query</string>
        <key>ServerAddresses</key>
        <array>
          <string>1.1.1.2</string>
          <string>1.0.0.2</string>
          <string>2606:4700:4700::1112</string>
          <string>2606:4700:4700::1002</string>
        </array>
      </dict>
      <key>PayloadDisplayName</key>
      <string>Clickey protective DNS</string>
      <key>PayloadIdentifier</key>
      <string>dev.squeek.clickey.dns.settings</string>
      <key>PayloadType</key>
      <string>com.apple.dnsSettings.managed</string>
      <key>PayloadUUID</key>
      <string>2C484687-EA6A-4728-BD0B-AFDF526FFA47</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Blocks known malware and phishing websites in every app using Cloudflare's free security DNS. Remove it any time in Settings › General › VPN &amp; Device Management.</string>
  <key>PayloadDisplayName</key>
  <string>Clickey protective DNS</string>
  <key>PayloadIdentifier</key>
  <string>dev.squeek.clickey.dns</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>9252513B-FFCF-4DA4-B7CF-CC9AD9E7B58C</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;

Deno.serve((req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  return new Response(req.method === "HEAD" ? null : PROFILE, {
    headers: {
      "Content-Type": "application/x-apple-aspen-config",
      "Content-Disposition": 'attachment; filename="Clickey-protective-DNS.mobileconfig"',
      "Cache-Control": "public, max-age=3600",
    },
  });
});
