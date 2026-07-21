type DesktopWindow = Window & { __TAURI_INTERNALS__?: unknown };

let permissionCheck: Promise<boolean> | null = null;

export const isDesktopApp = () =>
  typeof window !== "undefined" && Boolean((window as DesktopWindow).__TAURI_INTERNALS__);

export async function desktopNotificationsGranted() {
  if (!isDesktopApp()) return false;

  try {
    const { isPermissionGranted } = await import("@tauri-apps/plugin-notification");
    return await isPermissionGranted();
  } catch {
    return false;
  }
}

export function enableDesktopNotifications(options: { retry?: boolean } = {}) {
  if (!isDesktopApp()) return Promise.resolve(false);
  if (options.retry) permissionCheck = null;
  if (permissionCheck) return permissionCheck;

  const currentCheck = (async () => {
    try {
      const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    } catch {
      return false;
    }
  })();
  permissionCheck = currentCheck;

  currentCheck.then((granted) => {
    if (!granted && permissionCheck === currentCheck) permissionCheck = null;
  });

  return currentCheck;
}

export async function sendDesktopNotification(title: string, body: string) {
  if (!(await desktopNotificationsGranted())) return;

  try {
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    sendNotification({ title, body });
  } catch {
    // Notifications are helpful but should never interrupt messaging.
  }
}
