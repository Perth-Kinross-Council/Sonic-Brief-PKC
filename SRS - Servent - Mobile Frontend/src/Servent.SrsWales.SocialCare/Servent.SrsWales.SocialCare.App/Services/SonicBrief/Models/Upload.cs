using System.Text.Json.Serialization;

namespace Servent.SrsWales.SocialCare.App.Services.SonicBrief.Models;

public class Upload
{
    [JsonPropertyName("file")]
    public string File { get; set; } = string.Empty;

    [JsonPropertyName("prompt_category_id")]
    public string CategoryId { get; set; } = string.Empty;

    [JsonPropertyName("prompt_subcategory_id")]
    public string SubCategoryId { get; set; } = string.Empty;

    [JsonPropertyName("case_id")]
    public string CaseId { get; set; } = string.Empty;

    [JsonPropertyName("recording_user_email")]
    public string Email { get; set; } = string.Empty;
}
