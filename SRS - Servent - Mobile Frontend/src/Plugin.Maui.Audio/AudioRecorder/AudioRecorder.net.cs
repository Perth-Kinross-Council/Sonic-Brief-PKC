namespace Plugin.Maui.Audio;

partial class AudioRecorder : IAudioRecorder
{
    public AudioRecorder(AudioRecorderOptions options)
    {
    }

    public bool CanRecordAudio => false;

    public bool IsRecording => false;

    public bool IsPaused => false;

    public Task StartAsync(AudioRecorderOptions? options = null) => Task.CompletedTask;

    public Task StartAsync(string filePath, AudioRecorderOptions? options = null) => Task.CompletedTask;

    public Task<IAudioSource> StopAsync() => Task.FromResult<IAudioSource>(new EmptyAudioSource());

    public Task PauseAsync() => Task.CompletedTask;

    public Task ResumeAsync() => Task.CompletedTask;
}