using System.Text.Json.Serialization;

namespace Servent.SrsWales.SocialCare.App.Services.SonicBrief.Models;

public class Job
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("file_path")]
    public string FilePath { get; set; } = string.Empty;

    [JsonPropertyName("transcription_file_path")]
    public string TranscriptionFilePath { get; set; } = string.Empty;

    [JsonPropertyName("analysis_file_path")]
    public string AnalysisFilePath { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("created_at")]
    public long CreatedAt { get; set; }
    public DateTimeOffset CreatedAtDateTime => DateTimeOffset.FromUnixTimeSeconds(CreatedAt);

    [JsonPropertyName("case_id")]
    public string CaseId { get; set; } = string.Empty;

    [JsonPropertyName("analysis_text")]
    public string AnalysisText { get; set; } = string.Empty;
}
