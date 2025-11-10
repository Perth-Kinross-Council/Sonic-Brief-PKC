using Plugin.Maui.Audio;

namespace Servent.SrsWales.SocialCare.App.Services;

public interface IAudioPlayerService
{
    void Load(string filePath);
    void Play();
    void Pause();
    void Stop();
    void Seek(double duration);

    bool IsPlaying { get; }
    string RecordingsPath { get; }
    double CurrentPosition { get; }
    double Duration { get; }
    bool HasAudioSource { get; }

    event Action? PropertyChanged;
}

public class AudioPlayerService : IAudioPlayerService
{
    private IAudioManager _audioManager;
    private IAudioPlayer _audioPlayer;
    private IDispatcher _dispatcher;

    public event Action? PropertyChanged;

    public AudioPlayerService(IAudioManager audioManager, IDispatcher dispatcher)
    {
        _audioManager = audioManager;

        // Ensure recordings folder exists
        var doesRecordingsFolderExist = Directory.Exists(RecordingsPath);
        if (!doesRecordingsFolderExist)
        {
            Directory.CreateDirectory(RecordingsPath);
        }

        _dispatcher = dispatcher;
    }

    public string RecordingsPath => Path.Combine(FileSystem.Current.CacheDirectory, "recordings");
    public bool HasAudioSource => _audioPlayer is not null;
    public bool IsPlaying => _audioPlayer?.IsPlaying ?? false;
    public double Duration => _audioPlayer?.Duration ?? 1;

    double currentPosition = 0;
    public double CurrentPosition
    {
        get => currentPosition;
        set
        {
            currentPosition = value;
            PropertyChanged?.Invoke();
        }
    }

    public double Volume
    {
        get => _audioPlayer?.Volume ?? 1;
        set
        {
            if (_audioPlayer != null)
            {
                _audioPlayer.Volume = value;
            }
        }
    }

    public async void Load(string filePath)
    {
        _audioPlayer?.Stop();
        _audioPlayer?.Dispose();

        var doesFileExist = File.Exists(filePath);
        if (!doesFileExist)
        {
            return;
        }

        _audioPlayer = _audioManager.CreatePlayer(filePath);

        _audioPlayer.PlaybackEnded += (s, e) =>
        {
            CurrentPosition = 0;
            PropertyChanged?.Invoke();
        };

#if WINDOWS
        // On windows, without this delay, the states are not updated in time
        await Task.Delay(50);
#endif

        PropertyChanged?.Invoke();
    }

    public void Play()
    {
        if (_audioPlayer is null)
        {
            return;
        }

        _audioPlayer.Play();
        UpdatePlaybackPosition();
        PropertyChanged?.Invoke();
    }

    public void Pause()
    {
        if (_audioPlayer is null)
        {
            return;
        }

        _audioPlayer.Pause();
        UpdatePlaybackPosition();
        PropertyChanged?.Invoke();
    }

    public void Stop()
    {
        if (_audioPlayer is null)
        {
            return;
        }

        _audioPlayer.Stop();
        CurrentPosition = 0;
        PropertyChanged?.Invoke();
    }

    public void Seek(double duration)
    {
        if (_audioPlayer is not null && duration >= 0 && duration <= Duration)
        {
            _audioPlayer.Seek(duration);
        }
    }

    private void UpdatePlaybackPosition()
    {
        if (_audioPlayer?.IsPlaying is false)
        {
#if WINDOWS
			// On windows, without this delay, the playback state is not updated in time
			// instead of this hack, we should update the windows state machine to be more reactive, or use an event based approach to update the UI
			Thread.Sleep(50);
#endif

            if (_audioPlayer?.IsPlaying is false)
            {
                CurrentPosition = _audioPlayer.CurrentPosition;
                PropertyChanged?.Invoke();
                return;
            }
        }

        _dispatcher.DispatchDelayed(
            TimeSpan.FromMilliseconds(16),
            () =>
            {
                CurrentPosition = _audioPlayer?.CurrentPosition ?? 0;
                PropertyChanged?.Invoke();
                UpdatePlaybackPosition();
            });
    }
}
