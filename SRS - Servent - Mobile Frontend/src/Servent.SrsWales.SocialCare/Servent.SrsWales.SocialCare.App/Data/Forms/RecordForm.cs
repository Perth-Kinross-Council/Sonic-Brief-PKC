using System.ComponentModel.DataAnnotations;
using Servent.SrsWales.SocialCare.App.Services.SonicBrief.Models;

namespace Servent.SrsWales.SocialCare.App.Data.Forms;

public class RecordForm
{
    [Required(ErrorMessage = "Case Id required")]
    public string CaseId { get; set; } = string.Empty;

    [Required(ErrorMessage = "Service Area is required")]
    public Category? Category { get; set; }

    [Required(ErrorMessage = "Service Function / Meeting is required")]
    public Subcategory? SubCategory { get; set; }
}