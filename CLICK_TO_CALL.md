# Web → Android SIM click-to-call · v0.8.1

This is a user-enabled background bridge, not browser `tel:` dialing and not a requirement to keep the CRM activity visible. A persistent **Salesdesk is running** foreground-service notification provides an Open/Manage action and **Pause calling** control. The native service uses Android `TelecomManager.placeCall` for a requested SIM call; it does not simulate taps in the Phone app.

## Enable yourself

1. Install the updated Android APK and sign in using the same CRM user as web. No automatic permission grants or real calls are performed during installation.
2. In mobile Settings → Background web click-to-call, grant Phone, phone-state and notification permissions. Phone-state is used to avoid starting another request during an existing call. Enable the explicit background-call switch.
3. Confirm **Salesdesk is running** in the notification shade. You may minimize Salesdesk or dismiss its task; the service declares `stopWithTask=false`. Its lifetime is separate from the activity. You can pause it from Settings or notification, and logout stops it.
4. By default locked phones are unavailable. Enable **Also allow web-triggered calls while this phone is locked** only if intended. The app does not unlock the device or change its security settings.
5. In web CRM, click a lead → **Call on my phone** → select your ready phone → **Call now**. Only a lead assigned to this same user can be dialled. Carrier charges apply; dual-SIM/system policy may still require a SIM choice or prevent dialing. A request/launch is not proof the recipient answered.

## Connectivity and platform limits

- Device polls the authenticated device API every three seconds while the user-enabled service runs. Server heartbeat is ready for 15 seconds, commands expire after 30 seconds; local responses older than ten seconds are refused. USB debug requires the same reverse-port setup as mobile sync. Real untethered use requires an HTTPS device API reachable by the phone, which is not provisioned automatically.
- A user-started foreground service uses `specialUse` with an explicit subtype explanation for the remote call bridge. Google Play distribution requires review/approval of this usage and sensitive permissions; successful sideload/build is not store approval.
- Android/Vivo battery restrictions, network loss, Doze, user stopping active apps, permission revocation, session expiry, force-stop or reboot can interrupt service. `START_STICKY` is a request to Android, not a guarantee. No boot autostart, invisible keepalive tricks, overlay/default-dialer takeover, notification suppression, FCM wakeup or automatic system-setting changes are implemented.
- A Force-stopped app cannot honestly be promised to dial without being reopened. After reboot/force-stop, open Salesdesk and enable/restart the bridge. Battery/autostart optimization menus are user-controlled. Do not assume uninterrupted background calling until tested on the actual phones and deployment/network.

## Safety and authorization

- Same authenticated user/device binding as mobile CRM; web request requires an exact same-origin browser request, explicit confirmation, unique request ID and a ready unrevoked device. Admins do not remotely dial another user's assigned leads through this flow.
- Number comes from the stored assigned lead, not arbitrary client input. Only 8–15 digits with optional leading + are accepted; no USSD, extensions or short/emergency numbers.
- Server claims before delivery and device persists the receipt before calling. No delivery/ack failure causes automatic redial. Pending commands cancel if the lead changes owner/phone or receiver pauses. Ten-second per-user cooldown and one pending command prevent rapid repeated requests. A crash after claim may intentionally lose a request rather than dial twice.
- Existing call logs/recordings follow the separate opt-in sync workflow. A click request is not fabricated as a completed call. Acknowledgement `Dialer launched` means only Telecom invocation returned, not a connected/answered call.

## Evidence and verification

Automated SQLite and authenticated HTTP tests cover ownership, consent/origin, ready/offline/revoked devices, expiration, repeated clicks, single claim, acknowledgements, changed leads and session revocation using synthetic data. Android build/lint is checked separately. Real SIM background/locked/swipe-away behavior is not yet verified and requires user-granted permissions plus a user-selected test number; no live call was placed.

Android references: [TelecomManager.placeCall](https://developer.android.com/reference/android/telecom/TelecomManager#placeCall(android.net.Uri,android.os.Bundle)), [foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types), [background service start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).
