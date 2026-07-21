import type { Metadata } from "next";
import DownloadSection from "@/app/DownloadSection";

export const metadata: Metadata = {
  title: "Download Relay for macOS and Windows",
  description: "Download the free Relay desktop application for Apple Silicon Mac, Intel Mac, or Windows.",
};

export default function DownloadPage() {
  return <main className="download-page">
    <nav className="landing-nav" aria-label="Download navigation">
      <a className="brand brand-dark" href="../" aria-label="Relay home"><span className="brand-mark">R</span><span>relay</span></a>
      <a className="nav-signin" href="../">Open Relay</a>
    </nav>
    <DownloadSection />
  </main>;
}
