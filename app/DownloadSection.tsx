const releaseBase = "https://github.com/smart-window/relay-chat/releases/download/desktop-v0.1.5";

export default function DownloadSection() {
  return <section className="desktop-downloads" id="download" aria-labelledby="download-title">
    <div className="download-heading"><div><p className="eyebrow">Relay on your computer</p><h2 id="download-title">Download. Sign in.<br />Keep talking.</h2></div><p>Use the same Relay account and conversations everywhere. Desktop notifications keep messages and calls close, even while you work.</p></div>
    <div className="download-grid">
      <a className="download-card" href={`${releaseBase}/Relay_0.1.5_darwin_aarch64_.dmg`} aria-label="Download Relay for Apple Silicon Mac"><span className="platform-icon">⌘</span><small>macOS 12 or newer</small><h3>Apple Silicon Mac</h3><p>For Macs with an M1, M2, M3, M4, or newer Apple chip.</p><strong>Download DMG <span>↓</span></strong></a>
      <a className="download-card" href={`${releaseBase}/Relay_0.1.5_darwin_x64_.dmg`} aria-label="Download Relay for Intel Mac"><span className="platform-icon">⌘</span><small>macOS 12 or newer</small><h3>Intel Mac</h3><p>For Macs with an Intel processor manufactured before Apple Silicon.</p><strong>Download DMG <span>↓</span></strong></a>
      <a className="download-card featured" href={`${releaseBase}/Relay_0.1.5_windows_x64_-setup.exe`} aria-label="Download Relay for 64-bit Windows"><span className="platform-icon windows-icon">⊞</span><small>64-bit Windows</small><h3>Windows PC</h3><p>A guided setup for Windows computers, including notification support.</p><strong>Download EXE <span>↓</span></strong></a>
    </div>
    <p className="download-note">Relay Desktop v0.1.5 · Includes signed in-app updates · <a href="https://github.com/smart-window/relay-chat/releases/tag/desktop-v0.1.5">View release details and MSI installer</a></p>
  </section>;
}
