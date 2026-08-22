namespace ShiftOMator.Domain;

public class Holiday
{
    public required string Id { get; set; }
    public required DateOnly Date { get; set; }
    public required string Name { get; set; }
    public List<string> LocationIds { get; set; } = [];
    public bool IsFullDay { get; set; } = true;
}
