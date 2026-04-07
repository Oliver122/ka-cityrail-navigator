import { ConnectionInfo } from "./types";

export interface NetworkInfo {
  ssid: string;
  label: string;
}

export function resolveActiveNetwork(
  detectionAvailable: boolean,
  detectedNetwork: NetworkInfo | null,
  manualNetworkSsid: string | null
): NetworkInfo | null {
  if (detectedNetwork) return detectedNetwork;
  if (!detectionAvailable && manualNetworkSsid) {
    return {
      ssid: manualNetworkSsid,
      label: `${manualNetworkSsid} (manual)`,
    };
  }
  return null;
}

export function resolveConnectionType(
  detectionAvailable: boolean,
  connection: ConnectionInfo | null
): "wifi" | "ethernet" {
  if (connection) return connection.conn_type;
  // On Android/manual fallback we still render a stable network icon.
  if (!detectionAvailable) return "wifi";
  return "wifi";
}

export function shouldUseManualLocation(permissionGranted: boolean, geolocationSucceeded: boolean): boolean {
  if (!permissionGranted) return true;
  return !geolocationSucceeded;
}
