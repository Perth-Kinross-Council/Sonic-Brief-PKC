namespace Servent.SrsWales.SocialCare.App.Services.SonicBrief.Models;

public class Category
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;

    public override string ToString()
    {
        return Name;
    }
}
