/* URL capture can be switched off for a deployment: NEXT_PUBLIC_CAPTURE=off in the host's environment.
   The editor reads it when it's built, so changing it takes a redeploy. Off, the editor offers no
   From URL…, Capture from URL…, Re-capture or Re-capture all, and the capture routes refuse, so no
   browser is ever started. Uploading, dropping and pasting screenshots work as always. */
export const captureOn = (): boolean => process.env.NEXT_PUBLIC_CAPTURE !== 'off';
