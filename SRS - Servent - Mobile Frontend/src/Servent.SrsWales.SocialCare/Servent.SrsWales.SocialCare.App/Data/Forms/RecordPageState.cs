namespace Servent.SrsWales.SocialCare.App.Data.Forms;

public class RecordPageState
{
    public Recording CurrentRecording = new Recording();
    public bool IsFormValid { get; set; } = false;
    public bool CanRecord { get; set; } = false;
    public bool IsRecordingComplete { get; set; } = false;
}