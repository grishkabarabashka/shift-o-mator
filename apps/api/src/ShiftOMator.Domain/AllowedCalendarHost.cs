namespace ShiftOMator.Domain;

/// <summary>
/// A host the holiday-import endpoint may fetch a calendar feed from.
///
/// WHY this is data, not configuration: <c>HolidayImportEndpoints</c> reads it per
/// request — to build the offered-calendars list and to gate a URL fetch — never at
/// startup, the same shape as <c>SystemSetup.DirectoryRoles</c> (ADR-0063). As
/// configuration it cost a redeploy to add a host and was invisible on the one screen
/// that names the risk it exists to contain: an admin endpoint that fetches an arbitrary
/// URL is a request-forgery proxy pointed at whatever the server can reach, so the
/// allowlist is the feature, and the feature belongs beside the import it protects.
///
/// The host is the key. There is nothing else to store per row — "is this host allowed"
/// is a yes, and a row's presence is the yes.
/// </summary>
public class AllowedCalendarHost
{
    public required string Host { get; set; }
}
