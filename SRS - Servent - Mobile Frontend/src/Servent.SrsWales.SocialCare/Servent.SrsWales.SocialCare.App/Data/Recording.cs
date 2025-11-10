using Servent.SrsWales.SocialCare.App.Services.SonicBrief.Models;

namespace Servent.SrsWales.SocialCare.App.Data;

public class Recording
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Category Category { get; set; }
    public Subcategory SubCategory { get; set; }
    public string CaseId { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? UpdatedAt { get; set; } = null;
    public string? RecordingPath { get; set; } = null;
    public TimeSpan RecordingDuration { get; set; }
    public Status Status { get; set; } = Status.Pending;
    public string? JobId { get; set; } = null;
    public string? TranscriptionText { get; set; } = null;
    public string? TranscriptionPath { get; set; } = null;
    public string? AnalysisText { get; set; } = null;
    public string? AnalysisPath { get; set; } = null;
    public string? Creator { get; set; } = null;

    public bool CanUpload => AreMinimumFieldsSet() && (Status == Status.Pending || Status == Status.Failed) && File.Exists(RecordingPath);

    private bool AreMinimumFieldsSet()
    {
        return Category != null && SubCategory != null && !string.IsNullOrWhiteSpace(CaseId) && !string.IsNullOrWhiteSpace(RecordingPath);
    }
}
