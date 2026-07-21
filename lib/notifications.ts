type DesktopWindow = Window & { __TAURI_INTERNALS__?: unknown };

let permissionCheck: Promise<boolean> | null = null;

export const isDesktopApp = () =>
  typeof window !== "undefined" && Boolean((window as DesktopWindow).__TAURI_INTERNALS__);

export function enableDesktopNotifications() {
  if (!isDesktopApp()) return Promise.resolve(false);
  if (permissionCheck) return permissionCheck;

  permissionCheck = (async () => {
    try {
      const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    } catch {
      return false;
    }
  })();

  return permissionCheck;
}

export async function sendDesktopNotification(title: string, body: string) {
  if (!(await enableDesktopNotifications())) return;

  try {
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    sendNotification({ title, body });
  } catch {
    // Notifications are helpful but should never interrupt messaging.
  }
}
