const $ = (id) => document.getElementById(id);

const UNITS = [
    [31536000, 'year'],
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
];

const RELATIVE = [
    [3600, 60, 'minute'],
    [86400, 3600, 'hour'],
    [2592000, 86400, 'day'],
    [31536000, 2592000, 'month'],
    [Infinity, 31536000, 'year'],
];

const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function humanize(seconds) {
    const [size, name] = UNITS.find(([size]) => seconds >= size && seconds % size === 0) ?? [1, 'second'];
    const count = Math.round(seconds / size);
    return `${count} ${name}${count === 1 ? '' : 's'}`;
}

function fromNow(timestamp) {
    const diff = timestamp - Date.now() / 1000;
    const [, size, unit] = RELATIVE.find(([limit]) => Math.abs(diff) < limit);
    return relativeFormat.format(Math.max(1, Math.round(diff / size)), unit);
}

function formatDate(timestamp, withTime) {
    const options = withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' };
    return new Date(timestamp * 1000).toLocaleString(undefined, options);
}

function show(ban, seconds) {
    const server = ban.server || 'this server';
    $('server').textContent = ban.server ?? '';
    $('header-id').textContent = `#${ban.id}`;
    $('ban-id').textContent = `#${ban.id}`;
    $('reason').textContent = ban.reason;
    $('banned-on').textContent = `Banned on ${formatDate(ban.created_at)}`;

    const by = document.createElement('b');
    by.textContent = ban.banned_by;
    $('lead').replaceChildren(`You can't play on ${server} right now. Banned by `, by, '.');

    if (ban.expires_at) {
        $('duration').textContent = humanize(ban.expires_at - ban.created_at);
        $('expires').textContent = fromNow(ban.expires_at);
        $('expires-at').textContent = formatDate(ban.expires_at, true);
    } else {
        $('duration').textContent = 'Permanent';
        $('expires').textContent = 'Never';
        $('expires-at').textContent = 'This ban does not run out';
    }

    $('appeal-section').hidden = !ban.appeal;
    $('appeal').textContent = ban.appeal ?? '';
    $('appeal-id').textContent = `#${ban.id}`;

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
