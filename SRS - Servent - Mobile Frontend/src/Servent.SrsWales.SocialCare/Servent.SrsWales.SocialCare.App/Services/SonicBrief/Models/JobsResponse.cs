using System.Text.Json.Serialization;

namespace Servent.SrsWales.SocialCare.App.Services.SonicBrief.Models;

public class JobsResponse
{
    [JsonPropertyName("status")]
    public int Status { get; set; }

    [JsonPropertyName("jobs")]
    public List<Job> Jobs { get; set; } = [];
}
