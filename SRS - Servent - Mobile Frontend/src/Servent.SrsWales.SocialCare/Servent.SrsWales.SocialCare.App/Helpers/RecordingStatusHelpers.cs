using Servent.SrsWales.SocialCare.App.Data;

namespace Servent.SrsWales.SocialCare.App.Helpers
{
    public static class RecordingStatusHelpers
    {
        public static Status GetRecordingStatus(string status)
        {
            return status switch
            {
                "uploaded" => Status.Uploaded,
                "processing" => Status.Processing,
                "transcribing" => Status.Processing,
                "transcribed" => Status.Processing,
                "completed" => Status.Completed,
                "failed" => Status.Failed,
                _ => Status.Failed,
            };
        }
    }
}
