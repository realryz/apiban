const MINUTE: i64 = 60;
const HOUR: i64 = 60 * MINUTE;
const DAY: i64 = 24 * HOUR;
const WEEK: i64 = 7 * DAY;
const YEAR: i64 = 365 * DAY;
const MAX: i64 = 100 * YEAR;

/// Parses a ban length such as `30m`, `12h`, `7d`, `2w`, `1y` or `7 days`.
/// Empty input and `perm` / `permanent` mean a permanent ban (`None`).
pub fn parse(input: Option<&str>) -> Result<Option<i64>, String> {
    let raw = input.unwrap_or("").trim().to_ascii_lowercase();
    if matches!(raw.as_str(), "" | "perm" | "permanent" | "forever" | "never") {
        return Ok(None);
    }

    let invalid = || format!("invalid duration `{raw}`, use e.g. 30m, 12h, 7d, 2w, 1y or perm");
    let split = raw.find(|c: char| !c.is_ascii_digit()).unwrap_or(raw.len());
    let (number, unit) = raw.split_at(split);
    let unit = match unit.trim() {
        "m" | "min" | "mins" | "minute" | "minutes" => MINUTE,
        "h" | "hr" | "hrs" | "hour" | "hours" => HOUR,
        "d" | "day" | "days" => DAY,
        "w" | "week" | "weeks" => WEEK,
        "y" | "year" | "years" => YEAR,
        _ => return Err(invalid()),
    };
    let count: i64 = number.parse().map_err(|_| invalid())?;
    if count == 0 {
        return Err("duration must be greater than zero".into());
    }
    count
        .checked_mul(unit)
        .filter(|seconds| *seconds <= MAX)
        .map(Some)
        .ok_or_else(|| "duration is too long, use perm for a permanent ban".into())
}

/// Formats a length in seconds with the largest unit that divides it exactly.
pub fn humanize(seconds: i64) -> String {
    let units = [(YEAR, "year"), (WEEK, "week"), (DAY, "day"), (HOUR, "hour"), (MINUTE, "minute")];
    let (size, name) = units
        .into_iter()
        .find(|(size, _)| seconds >= *size && seconds % size == 0)
        .unwrap_or((1, "second"));
    let count = seconds / size;
    format!("{count} {name}{}", if count == 1 { "" } else { "s" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_durations() {
        assert_eq!(parse(None), Ok(None));
        assert_eq!(parse(Some(" Perm ")), Ok(None));
        assert_eq!(parse(Some("30m")), Ok(Some(30 * MINUTE)));
        assert_eq!(parse(Some("12h")), Ok(Some(12 * HOUR)));
        assert_eq!(parse(Some("7 days")), Ok(Some(7 * DAY)));
        assert_eq!(parse(Some("2W")), Ok(Some(2 * WEEK)));
        assert_eq!(parse(Some("1y")), Ok(Some(YEAR)));
    }

    #[test]
    fn rejects_bad_durations() {
        for input in ["7", "d", "0d", "-1d", "1.5h", "3 months", "999999999999y"] {
            assert!(parse(Some(input)).is_err(), "{input} should be rejected");
        }
    }

    #[test]
    fn humanizes() {
        assert_eq!(humanize(DAY), "1 day");
        assert_eq!(humanize(14 * DAY), "2 weeks");
        assert_eq!(humanize(36 * HOUR), "36 hours");
        assert_eq!(humanize(90 * MINUTE), "90 minutes");
    }
}
