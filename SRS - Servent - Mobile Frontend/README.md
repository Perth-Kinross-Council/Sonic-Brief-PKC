# Servent SRS Wales Social Care App

Hybrid .NET MAUI (Android / iOS) + Blazor application targeting .NET9.

##1. Configuration (appsettings.json)
`Servent.SrsWales.SocialCare.App/appsettings.json` is embedded as an `EmbeddedResource` in the MAUI project.
Update these keys before first deployment:

- `ApiBaseUrl` (backend API root URL)
- `EntraAppRegClientId` (Entra ID application client id)
- `EntraAppRegClientSecret` (Entra ID application client secret)
- `EntraTenantId` (Directory / tenant id)
- `EntraScopes` (array of delegated scopes – must match exposed API scopes, e.g. `api://<api-app-id>/access_as_user`, `openid`, `profile`, `email`)
- `DataRetentionDays` (Number of days audio files are kept on the device)

Keep the values consistent with `MauiAuthenticationStateProvider` (currently hard‑coded). Refactor that class to read from `IConfiguration` to avoid duplication.

##2. Branding (Icon & Splash)
Update image assets under:
```
Resources/AppIcon/appicon.png
Resources/Splash/splash.png
```
Confirm `.csproj` contains:
```
<MauiIcon Include="Resources\AppIcon\appicon.png" Color="#512BD4" />
<MauiSplashScreen Include="Resources\Splash\splash.png" BaseSize="444,248" Color="#000000" />
```
Use high‑resolution SVG or PNG for icons and splash (transparent optional).

##3. Project Metadata (`Servent.SrsWales.SocialCare.App.csproj`)
Adjust:
- `<ApplicationTitle>` (display name)
- `<ApplicationId>` (Android package; reverse DNS. Changing requires uninstalling previous builds.)
- `<ApplicationDisplayVersion>` / `<ApplicationVersion>` (increment per release)
- `<SupportedOSPlatformVersion>` for platform minimum versions.

##4. Android Platform (MSAL)
Add / edit `Platforms/Android/AndroidManifest.xml` if not present. MSAL redirect intent filter must match `WithRedirectUri("msal<clientId>://auth")`.
Example snippet:
```xml
<manifest package="com.companyname.servent.srswales.socialcare.app">
 <application>
 <activity android:name="com.microsoft.identity.client.BrowserTabActivity">
 <intent-filter>
 <action android:name="android.intent.action.VIEW" />
 <category android:name="android.intent.category.DEFAULT" />
 <category android:name="android.intent.category.BROWSABLE" />
 <data android:scheme="msal<YOUR-CLIENT-ID>" android:host="auth" />
 </intent-filter>
 </activity>
 </application>
</manifest>
```
Replace `<YOUR-CLIENT-ID>` (GUID) exactly as registered. Ensure the generated MAUI `MainActivity` is present (do not remove platform files).

##5. iOS Platform (MSAL)
Add to `Platforms/iOS/Info.plist`:
```xml
<key>CFBundleURLTypes</key>
<array>
 <dict>
 <key>CFBundleURLSchemes</key>
 <array>
 <string>msal<YOUR-CLIENT-ID></string>
 </array>
 </dict>
</array>
```
Query schemes (for broker support):
```xml
<key>LSApplicationQueriesSchemes</key>
<array>
 <string>msauthv3</string>
 <string>msauthv2</string>
 <string>msauth</string>
 <string>browser</string>
</array>
```
Minimum iOS version must be >= value in `<SupportedOSPlatformVersion>` (currently15.0).

##6. Recording Storage & Deletion
Audio recordings stored in `FileSystem.Current.CacheDirectory/recordings` (`RecordingsPath`).
`StorageService.DeleteRecording(Guid)` now deletes both metadata and the physical file. Ensure `Recording.RecordingPath` stores the filename (or resolvable path) consistent with that directory.

##7. Typical Developer Setup
1. Install .NET9 + MAUI workloads: `dotnet workload install maui`.
2. Clone repo & checkout branch.
3. Configure `appsettings.json` values.
4. Update branding assets & project metadata.
5. Add / update AndroidManifest & Info.plist for MSAL.
6. Clean & build: `dotnet build` (or via IDE).
7. Deploy: `net9.0-android` to emulator/device; pair to Mac for `net9.0-ios`.

##8. Troubleshooting
| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| `ClassNotFoundException: MainActivity` | Missing Android platform file | Restore MAUI Android template files. |
| MSAL redirect error | Scheme mismatch | Align redirect URI in code + manifest + Info.plist. |
| Silent token fails | No cached account / wrong scopes | Perform interactive login first; verify scopes. |
| Recording file remains | Path mismatch or deletion failure | Check `RecordingsPath` and filename extraction. |
| WAV file header invalid | Recording interrupted before header update | Ensure `StopAsync()` finishes; avoid killing app mid-write. |

##9. Security
- Do not commit secrets (client secrets, production endpoints).
- Tokens are ephemeral; avoid persisting access tokens on disk.
- Consider adding SSL pinning & telemetry controls.

##10. Future Improvements
- Inject `IConfiguration` into auth provider.
- Environment-specific `appsettings.{Environment}.json`.
- Token expiration handling & refresh logic.
- Unit tests for storage & audio components.

---
Keep README updated when configuration or platform requirements change.
