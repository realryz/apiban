const $ = (id) => document.getElementById(id);

const UNITS = [
    [31536000, 'year'],
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
];

// Largest unit that divides the length exactly, e.g. 604800 -> "1 week".
function humanize(seconds) {
    const [size, name] = UNITS.find(([size]) => seconds >= size && seconds % size === 0) ?? [1, 'second'];
    const count = Math.round(seconds / size);
    return `${count} ${name}${count === 1 ? '' : 's'}`;
}

function formatDate(timestamp) {
    return new Date(timestamp * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function show(ban, seconds) {
    $('server').textContent = ban.server ?? '';
    $('reason').textContent = ban.reason;
    $('ban-id').textContent = `#${ban.id}`;
    $('banned-by').textContent = ban.banned_by;

    if (ban.expires_at) {
        $('duration').textContent = humanize(ban.expires_at - ban.created_at);
        $('expires').textContent = formatDate(ban.expires_at);
    } else {
        $('duration').textContent = 'Permanent';
        $('expires').textContent = 'Never';
    }

    const appeal = $('appeal');
    appeal.hidden = !ban.appeal;
    if (ban.appeal) {
        const link = document.createElement('strong');
        link.textContent = ban.appeal;
        appeal.replaceChildren('Think this is a mistake? Appeal at ', link, ' with your Ban ID.');
    }

    $('screen').hidden = false;

    const total = seconds * 1000;
    const end = Date.now() + total;
    const tick = () => {
        const left = Math.max(0, end - Date.now());
        $('seconds').textContent = Math.ceil(left / 1000);
        $('bar').style.transform = `scaleX(${left / total})`;
        if (left > 0) requestAnimationFrame(tick);
    };
    tick();
}

window.addEventListener('message', (event) => {
    if (event.data?.type === 'banned') show(event.data.ban, event.data.seconds || 10);
});
