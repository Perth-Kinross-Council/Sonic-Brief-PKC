using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Servent.SrsWales.SocialCare.App.Data;
using Servent.SrsWales.SocialCare.App.Helpers;
using Servent.SrsWales.SocialCare.App.Services.SonicBrief.Models;

namespace Servent.SrsWales.SocialCare.App.Services;

public class StorageService
{
    private readonly ILogger<UserService> _logger;
    private readonly IConfiguration _configuration;
    private readonly UserService _userService;

    public string StoragePath => Path.Combine(FileSystem.Current.AppDataDirectory);

    public StorageService(ILogger<UserService> logger, IConfiguration configuration, UserService userService)
    {
        _logger = logger;

        var doesStoragePathExist = Directory.Exists(Path.Combine(StoragePath, "static"));
        if (!doesStoragePathExist)
        {
            Directory.CreateDirectory(StoragePath);
        }

        _configuration = configuration;
        _userService = userService;
    }

    public async Task<List<Category>> GetCategoriesAsync()
    {
        var filePath = Path.Combine(StoragePath, "categories.json");
        if (!File.Exists(filePath))
        {
            return [];
        }

        try
        {
            using var stream = File.OpenRead(filePath);
            var categories = await JsonSerializer.DeserializeAsync<List<Category>>(stream);
            return categories ?? [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read or deserialize categories.json");
            return [];
        }
    }

    public async Task SetCategoriesAsync(List<Category> categories)
    {
        var filePath = Path.Combine(StoragePath, "categories.json");

        try
        {
            using var stream = File.Create(filePath);
            await JsonSerializer.SerializeAsync(stream, categories);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to write or serialize categories.json");
        }
    }

    public async Task<List<Subcategory>> GetSubcategoriesAsync()
    {
        var filePath = Path.Combine(StoragePath, "subcategories.json");
        if (!File.Exists(filePath))
        {
            return [];
        }

        try
        {
            using var stream = File.OpenRead(filePath);
            var subcategories = await JsonSerializer.DeserializeAsync<List<Subcategory>>(stream);
            return subcategories ?? [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read or deserialize subcategories.json");
            return [];
        }
    }

    public async Task SetSubcategoriesAsync(List<Subcategory> subcategories)
    {
        var filePath = Path.Combine(StoragePath, "subcategories.json");
        try
        {
            using var stream = File.Create(filePath);
            await JsonSerializer.SerializeAsync(stream, subcategories);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to write or serialize subcategories.json");
        }
    }

    public async Task<List<Recording>> GetRecordings()
    {
        var email = await _userService.GetEmail();

        var filePath = Path.Combine(StoragePath, "recordings.json");
        if (!File.Exists(filePath))
        {
            return [];
        }
        try
        {
            using var stream = File.OpenRead(filePath);
            var recordings = await JsonSerializer.DeserializeAsync<List<Recording>>(stream);

            return recordings?.Where(r => r.Creator == email).ToList() ?? [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read or deserialize recordings.json");
            return [];
        }
    }

    public async Task<Recording?> GetRecording(Guid recordingId)
    {
        var email = await _userService.GetEmail();

        var filePath = Path.Combine(StoragePath, "recordings.json");
        if (!File.Exists(filePath))
        {
            return null;
        }
        try
        {
            using var stream = File.OpenRead(filePath);
            var recordings = await JsonSerializer.DeserializeAsync<List<Recording>>(stream);
            return recordings?.FirstOrDefault(r => r.Id == recordingId && r.Creator == email);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read or deserialize recordings.json");
            return null;
        }
    }

    public async Task<Recording> AddRecording(Recording recording)
    {
        var filePath = Path.Combine(StoragePath, "recordings.json");
        List<Recording> recordings = [];

        if (File.Exists(filePath))
        {
            try
            {
                using var readStream = File.OpenRead(filePath);
                var existing = await JsonSerializer.DeserializeAsync<List<Recording>>(readStream);
                if (existing is not null)
                    recordings = existing;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to read or deserialize recordings.json");
            }
        }

        // Always add to the top of the list
        recordings.Insert(0, recording);

        try
        {
            using var writeStream = File.Create(filePath);
            await JsonSerializer.SerializeAsync(writeStream, recordings);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to write or serialize recordings.json");
        }

        return recording;
    }

    public async Task<Recording> UpdateRecording(Recording recording)
    {
        var email = await _userService.GetEmail();
        if (recording.Creator != email)
        {
            _logger.LogWarning("User {Email} attempted to update a recording they do not own", email);
            return recording;
        }

        var filePath = Path.Combine(StoragePath, "recordings.json");
        if (!File.Exists(filePath))
        {
            return recording;
        }

        List<Recording>? recordings = null;
        try
        {
            using (var readStream = File.OpenRead(filePath))
            {
                recordings = await JsonSerializer.DeserializeAsync<List<Recording>>(readStream);
            }

            if (recordings is null)
            {
                return recording;
            }

            var recordingToUpdate = recordings.FirstOrDefault(r => r.Id == recording.Id);
            if (recordingToUpdate != null)
            {
                recordingToUpdate.CaseId = recording.CaseId;
                recordingToUpdate.Category = recording.Category;
                recordingToUpdate.SubCategory = recording.SubCategory;
                recordingToUpdate.RecordingPath = recording.RecordingPath;
                recordingToUpdate.RecordingDuration = recording.RecordingDuration;
                recordingToUpdate.Status = recording.Status;
                recordingToUpdate.JobId = recording.JobId;
                recordingToUpdate.UpdatedAt = DateTimeOffset.UtcNow;

                using var writeStream = File.Create(filePath);
                await JsonSerializer.SerializeAsync(writeStream, recordings);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read or deserialize recordings.json");
        }

        return recording;
    }

    public async Task DeleteRecording(Guid recordingId)
    {
        var email = await _userService.GetEmail();

        var filePath = Path.Combine(StoragePath, "recordings.json");
        if (!File.Exists(filePath))
        {
            return;
        }

        List<Recording>? recordings = null;

        try
        {
            using (var readStream = File.OpenRead(filePath))
            {
                recordings = await JsonSerializer.DeserializeAsync<List<Recording>>(readStream);
            }

            if (recordings is null)
            {
                return;
            }

            // Ensure the user is the creator of the recording
            var recordingToRemove = recordings.FirstOrDefault(r => r.Id == recordingId && r.Creator == email);
            if (recordingToRemove != null)
            {
                // Remove physical file if it exists
                RemoveRecordingFile(recordingToRemove.RecordingPath);

                // Remove from the list and update the file
                recordings.Remove(recordingToRemove);
                using var writeStream = File.Create(filePath);
                await JsonSerializer.SerializeAsync(writeStream, recordings);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read or deserialize recordings.json");
        }
    }

    public async Task RemoveAllRecordings()
    {
        var filePath = Path.Combine(StoragePath, "recordings.json");
        if (!File.Exists(filePath))
        {
            return;
        }

        List<Recording>? recordings = null;

        try
        {
            using (var readStream = File.OpenRead(filePath))
            {
                recordings = await JsonSerializer.DeserializeAsync<List<Recording>>(readStream);
            }

            if (recordings is null || recordings.Count == 0)
            {
                return;
            }

            foreach (var recording in recordings.ToList())
            {
                // Remove physical file if it exists
                RemoveRecordingFile(recording.RecordingPath);
                recordings.Remove(recording);
            }

            recordings.Clear();
            using var writeStream = File.Create(filePath);
            await JsonSerializer.SerializeAsync(writeStream, recordings);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read or deserialize recordings.json");
        }
    }

    public async Task RemoveOldRecordings()
    {
        var filePath = Path.Combine(StoragePath, "recordings.json");
        if (!File.Exists(filePath))
        {
            return;
        }

        List<Recording>? recordings = null;

        try
        {
            var dataRetentionDays = _configuration.GetValue<int>("SonicBrief:DataRetentionDays", 14);

            using (var readStream = File.OpenRead(filePath))
            {
                recordings = await JsonSerializer.DeserializeAsync<List<Recording>>(readStream);
            }

            if (recordings is null || recordings.Count == 0)
            {
                return;
            }

            var recordingsToRemove = recordings.Where(r => (DateTimeOffset.UtcNow - r.CreatedAt).TotalDays > dataRetentionDays).ToList();
            foreach (var recording in recordingsToRemove)
            {
                // Remove physical file if it exists
                RemoveRecordingFile(recording.RecordingPath);
                recordings.Remove(recording);
            }

            using var writeStream = File.Create(filePath);
            await JsonSerializer.SerializeAsync(writeStream, recordings);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read or deserialize recordings.json");
        }
    }

    private void RemoveRecordingFile(string? recordingPath)
    {
        if (string.IsNullOrWhiteSpace(recordingPath))
        {
            return;
        }

        if (File.Exists(recordingPath))
        {
            try
            {
                File.Delete(recordingPath);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Failed to delete recording file: {recordingPath}");
            }
        }
    }

    public async Task UpdateRecordingsFromJobs(List<Job> jobs)
    {
        var filePath = Path.Combine(StoragePath, "recordings.json");
        if (!File.Exists(filePath))
        {
            return;
        }

        List<Recording>? recordings = null;

        try
        {
            using (var readStream = File.OpenRead(filePath))
            {
                recordings = await JsonSerializer.DeserializeAsync<List<Recording>>(readStream);
            }

            if (recordings is null || recordings.Count == 0)
            {
                return;
            }

            foreach (var recording in recordings)
            {
                var job = jobs.FirstOrDefault(j => j.Id == recording.JobId);
                if (job != null)
                {
                    recording.Status = RecordingStatusHelpers.GetRecordingStatus(job.Status);
                    recording.UpdatedAt = DateTimeOffset.UtcNow;
                    recording.AnalysisText = job.AnalysisText;
                    recording.AnalysisPath = job.AnalysisFilePath;
                    //recording.TranscriptionText = job.TranscriptionText;
                    recording.TranscriptionPath = job.TranscriptionFilePath;
                }
            }

            using var writeStream = File.Create(filePath);
            await JsonSerializer.SerializeAsync(writeStream, recordings);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read or deserialize recordings.json");
        }
    }
}
