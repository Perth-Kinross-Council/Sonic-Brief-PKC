using System.Text.Json.Serialization;

namespace Servent.SrsWales.SocialCare.App.Services.SonicBrief.Models;

public class Subcategory
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    [JsonPropertyName("category_id")]
    public string CategoryId { get; set; } = string.Empty;

    public override string ToString()
    {
        return Name;
    }
}
