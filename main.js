// ==UserScript==
// @name         osu! Web+
// @namespace    http://tampermonkey.net/
// @version      0.0.1
// @author       Patchi
// @match        https://osu.ppy.sh/*
// @match        https://lazer.ppy.sh/*
// @grant        window.onurlchange
// @grant        GM_xmlhttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @updateURL    https://github.com/Penguuuuu/osu-web-plus/main/main.js
// @downloadURL  https://github.com/Penguuuuu/osu-web-plus/main/main.js
// ==/UserScript==

(function() {
    'use strict';

    const mutationObservers = [];
    const userScoresMaps = new Map();
    let userData = null;
    let titleText = null;
    let versionText = null;

    const helpers = {
        createObserver(...args) {
            const observer = new MutationObserver(...args);
            mutationObservers.push(observer);

            return observer;
        },

        getUserId() {
            const match = window.location.pathname.match(/^\/users\/(\d+)/);
            return match ? match[1] : null;
        },

        getScoresMap(userId) {
            if (!userScoresMaps.has(userId)) {
                userScoresMaps.set(userId, {
                    firsts: new Map(),
                    best: new Map(),
                    pinned: new Map(),
                    recent: new Map(),
                    replays: new Map()
                });
            }

            return userScoresMaps.get(userId);
        },

        getElement(element) {
            return new Promise((resolve) => {
                const target = document.querySelector(element);
                if (target) {
                    resolve(target);
                    return;
                }

                const observer = helpers.createObserver(() => {
                    const target = document.querySelector(element);
                    if (target) {
                        observer.disconnect();
                        resolve(target);
                    }
                });

                observer.observe(document.body, { childList: true, subtree: true });
            });
        },

        getElementAttribute(element, attribute) {
            return new Promise((resolve) => {
                const target = element.getAttribute(attribute);
                if (target != null) {
                    resolve(target);
                    return;
                }

                const observer = helpers.createObserver(() => {
                    const target = element.getAttribute(attribute);
                    if (target != null) {
                        observer.disconnect();
                        resolve(target);
                    }
                });

                observer.observe(element, { attributes: true, attributeFilter: [attribute] });
            });
        },

        getElementByText(selector, text) {
            function findElementByText(selector, text) {
                const elements = document.querySelectorAll(selector);

                for (const element of elements) {
                    if (element.textContent.trim().includes(text)) {
                        return element;
                    }
                }

                return null;
            }

            return new Promise((resolve) => {
                const target = findElementByText(selector, text);
                if (target) {
                    resolve(target);
                    return;
                }

                const observer = helpers.createObserver(() => {
                    const target = findElementByText(selector, text);
                    if (target) {
                        observer.disconnect();
                        resolve(target);
                    }
                });

                observer.observe(document.body, { childList: true, subtree: true });
            });
        },

        formatNumberToFixed(value, decimals = 2) {
            const decimalShift = 10 ** decimals;
            return (Math.floor(value * decimalShift) / decimalShift).toFixed(decimals);
        }
    }

    function setXHRCapture() {
        function pushDataToMap(map, items, nested = false) {
            for (const item of items) {
                const data = nested ? item.score : item;
                map.set(`${data.ended_at}::${data.id}`, data);
            }
        };

        function clearScoresMapKeys(userId, ...keys) {
            const scoresMap = helpers.getScoresMap(userId);
            for (const key of keys) {
                scoresMap[key].clear();
            }
        }

        const xhrCapture = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            this.addEventListener('load', () => {
                if (url.includes('score-pins')) {
                    const scoreId = Number(url.split('/').pop());
                    const userId = helpers.getUserId();
                    const scoresMap = helpers.getScoresMap(userId);
                    const isDeleteMethod = method === 'DELETE';

                    for (const mapKey of isDeleteMethod ? ['pinned'] : ['best', 'firsts', 'recent', 'replays']) {
                        for (const [key, score] of scoresMap[mapKey]) {
                            if (score.id !== scoreId) continue;

                            if (isDeleteMethod) {
                                scoresMap.pinned.delete(key)
                            } else {
                                scoresMap.pinned.set(key, score);
                            }

                            window.dispatchEvent(new Event('scores:pinned-updated'));
                            return;
                        }
                    }

                    return;
                }

                if (!this.responseText || this.status === 204) return; // score--pins has no data so this needs to be below

                const data = JSON.parse(this.responseText);
                const userId = helpers.getUserId();
                const scoresMap = helpers.getScoresMap(userId);

                if (url.includes('top_ranks')) {
                    clearScoresMapKeys(userId, 'firsts', 'best', 'pinned');

                    pushDataToMap(scoresMap.firsts, data.firsts?.items);
                    pushDataToMap(scoresMap.best, data.best?.items);
                    pushDataToMap(scoresMap.pinned, data.pinned?.items);

                    window.dispatchEvent(new Event('scores:tops-updated'));
                }
                if (url.includes('scores/firsts')) {
                    pushDataToMap(scoresMap.firsts, data);
                    window.dispatchEvent(new Event('scores:firsts-updated'));
                }
                if (url.includes('scores/best')) {
                    pushDataToMap(scoresMap.best, data);
                    window.dispatchEvent(new Event('scores:best-updated'));
                }
                if (url.includes('scores/pinned')) {
                    pushDataToMap(scoresMap.pinned, data);
                    window.dispatchEvent(new Event('scores:pinned-updated'));
                }

                if (url.includes('extra-pages/historical')) {
                    clearScoresMapKeys(userId, 'recent', 'replays');

                    pushDataToMap(scoresMap.recent, data.recent.items);
                    pushDataToMap(scoresMap.replays, data.score_replay_stats.items, true);

                    window.dispatchEvent(new Event('scores:historical-updated'));
                }
                if (url.includes('score-replay-stats')) {
                    pushDataToMap(scoresMap.replays, data, true);
                    window.dispatchEvent(new Event('scores:replays-updated'));
                }
                if (url.includes('scores/recent')) {
                    pushDataToMap(scoresMap.recent, data);
                    window.dispatchEvent(new Event('scores:recent-updated'));
                }
            });

            return xhrCapture.apply(this, arguments);
        };
    }

    async function run() {


        async function setUserData() {
            const target = await helpers.getElement('.osu-layout__section--full .u-contents');
            userData = JSON.parse(target.dataset.initialData);
        }

        async function updateStatsContainerDisplay() {
            const profileStatsContainer = await helpers.getElement('.profile-detail-stats');
            const profileStatsContainerInner = profileStatsContainer.querySelector(':scope > div');
            profileStatsContainerInner.style.display = 'flex';
            profileStatsContainerInner.style.flexDirection = 'column';
            profileStatsContainerInner.style.height = '100%';
            profileStatsContainerInner.style.justifyContent = 'space-between';
        }

        async function updateMedalCount() {
            await helpers.getElement('.value-display__label');

            const valueDisplay = (await helpers.getElementByText('.value-display__label', 'Medals')).closest('.value-display');

            if (valueDisplay) {
                valueDisplay.style.minWidth = 'unset';
                valueDisplay.querySelector('.value-display__value').textContent = `${userData.user.user_achievements.length}/${userData.achievements.length}`;
            }
        }

        async function updateLevelBar() {
            function levelToScore(level) {
                if (level <= 100) {
                    if (level > 1) {
                        return Math.floor(5000 / 3 * (4 * Math.pow(level, 3) - 3 * Math.pow(level, 2) - level) + Math.floor(1.25 * Math.pow(1.8, level - 60)));
                    }
                    return 1;
                }
                return 26_931_190_829 + 100_000_000_000 * (level - 100);
            }

            function formatScore(score, isScoreNeeded = false) {
                if (score < 1000) return `${score}`;

                const suffixes = [
                    [1e12, 'T'],
                    [1e9, 'B'],
                    [1e6, 'M'],
                    [1e3, 'K']
                ];

                for (const [value, suffix] of suffixes) {
                    if (score >= value) {
                        if (isScoreNeeded && score >= 100_000_000_000) {
                            return `${Math.floor(score / value)}${suffix}`; // it looks nicer this way
                        }

                        return `${helpers.formatNumberToFixed(score / value, 2)}${suffix}`;
                    }
                }
            }

            const levelBarContainer = await helpers.getElement('.profile-detail-bar__level-bar .bar');
            const levelBarText = await helpers.getElement('.profile-detail-bar__level-bar .bar .bar__text');

            const level = userData.user.statistics.level.current;
            const totalScore = userData.user.statistics.total_score;

            const cumulativeScore = levelToScore(level);
            const cumulativeScoreNext = levelToScore(level + 1);
            const neededScore = Math.round(cumulativeScoreNext - cumulativeScore);
            const currentScore = Math.floor(totalScore - cumulativeScore);

            levelBarText.textContent = `${formatScore(currentScore)}/${formatScore(neededScore, true)} (${helpers.formatNumberToFixed(currentScore / neededScore * 100, 3)}%)`;

            let updated = false;
            levelBarContainer.addEventListener('mouseenter', async () => {
                if (updated) return;

                const tooltipId = await helpers.getElementAttribute(levelBarContainer, 'aria-describedby');
                const tooltipContent = await helpers.getElement(`#${tooltipId}-content`);

                tooltipContent.textContent = `${(neededScore - currentScore).toLocaleString()} remaining`;

                updated = true;
            });
        }

        async function updatePPCount() {
            await helpers.getElement('.value-display__label');

            const valueDisplay = (await helpers.getElementByText('.value-display__label', 'pp')).closest('.value-display');

            if (valueDisplay) {
                valueDisplay.querySelector('.value-display__value').textContent = userData.user.statistics.pp
            }
        }

        async function setStats() {
            const hitsPerPlayContainerValue = await helpers.getElement('.profile-stats__entry--key-hits_per_play .profile-stats__value');
            hitsPerPlayContainerValue.textContent = helpers.formatNumberToFixed(userData.user.statistics.total_hits / userData.user.statistics.play_count, 4);

            const totalHitsContainer = await helpers.getElement('.profile-stats__entry--key-total_hits');
            const hits = [
                { name: 'Miss', value: userData.user.statistics.count_miss, className: 'hit_0' },
                { name: '50x', value: userData.user.statistics.count_50, className: 'hit_50' },
                { name: '100x', value: userData.user.statistics.count_100, className: 'hit_100' },
                { name: '300x', value: userData.user.statistics.count_300, className: 'hit_300' }
            ];

            for (const { name, value, className } of hits) {
                const hitContainer = createStat(
                    name,
                    `${value.toLocaleString()} (${helpers.formatNumberToFixed(value / (userData.user.statistics.count_300 + userData.user.statistics.count_100 + userData.user.statistics.count_50 + userData.user.statistics.count_miss) * 100, 2)}%)`,
                    className
                );
                totalHitsContainer.after(hitContainer);
            }

            const rankedScoreContainer = await helpers.getElement('.profile-stats__entry--key-ranked_score');
            const rankedScorePerPlay = createStat(
                'Ranked Score Per Play',
                Math.floor((userData.user.statistics.ranked_score / userData.user.statistics.play_count)).toLocaleString(),
                'ranked_score_per_play'
            );
            rankedScoreContainer.after(rankedScorePerPlay);

            const totalScoreContainer = await helpers.getElement('.profile-stats__entry--key-total_score');
            const totalScorePerPlay = createStat(
                'Total Score Per Play',
                Math.floor((userData.user.statistics.total_score / userData.user.statistics.play_count)).toLocaleString(),
                'total_score_per_play'
            );
            totalScoreContainer.after(totalScorePerPlay);

            const hitAccuracyContainer = await helpers.getElement('.profile-stats__entry--key-hit_accuracy');
            hitAccuracyContainer.querySelector('.profile-stats__value').textContent = `${userData.user.statistics.hit_accuracy}%`;

            function createStat(name, value, className) {
                const dl = document.createElement('dl');
                dl.className = `profile-stats__entry profile-stats__entry--key-${className}`;

                const dt = document.createElement('dt');
                dt.className = 'profile-stats__key';
                dt.textContent = name;

                const dd = document.createElement('dd');
                dd.className = 'profile-stats__value';
                dd.textContent = value;

                dl.append(dt, dd);

                return dl;
            }

            // the layout breaks so do this :v
            window.dispatchEvent(new Event('resize'));
        }

        function displayPopup() {
            const style = document.createElement('style');
            style.textContent = `
                .popup-osuwebplus {
                    width: 300px;
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    padding: 15px 10px;
                    background-color: hsl(var(--hsl-b4));
                    color: hsl(var(--hsl-c1));
                    border: 1px solid hsl(var(--hsl-b3));
                    border-radius: 6px;
                    box-shadow: 0 2px 10px rgba(0,0,0,.5);
                    z-index: 1000;
                }
                .button-popup-osuwebplus {
                    padding: 4px 8px;
                    color: #fff;
                    border: none;
                    background-color: hsl(var(--hsl-h2));
                    border-radius: 5px;
                }
                .button-popup-osuwebplus:hover {
                    text-decoration: underline;
                }
                .link-popup-osuwebplus {
                    margin-left: 5px;
                    color: hsl(var(--hsl-l1));
                }
                .link-popup-osuwebplus:hover {
                    text-decoration: underline;
                }
            `;
            document.head.appendChild(style);

            const popup = document.createElement('div');
            popup.classList.add('popup-osuwebplus');
            popup.innerHTML = `
                <b>${titleText}</b><br>
                <b>Version:</b> ${versionText}<br>
                <b>Notes:</b><br>
                <ul style="list-style: none; padding-left: 10px;">
                    <li>- Initial commit</li>
                </ul>
            `;

            const button = document.createElement('button');
            button.classList.add('button-popup-osuwebplus');
            button.textContent = 'Close';
            button.onclick = async () => {
                await GM.setValue('popupClosed', true);
                await GM.setValue('oldVersion', GM_info.script.version);
                popup.remove();
            };

            const link = document.createElement('a');
            link.classList.add('link-popup-osuwebplus');
            link.href = 'https://github.com/Penguuuuu/osu-web-plus/commits/main';
            link.textContent = 'Source';
            link.target = '_blank';

            popup.append(button, link);
            document.body.appendChild(popup);
        }

        try {
            const currentVersion = GM_info.script.version;
            const oldVersion = await GM.getValue('oldVersion', 0);
            const popupClosed = await GM.getValue('popupClosed', true);

            if (oldVersion !== currentVersion || !popupClosed) {
                await GM.setValue('popupClosed', false);

                if (!oldVersion) {
                    versionText = currentVersion;
                    titleText = 'osu! Web+ Installed!';
                }
                else {
                    versionText = `${oldVersion} > ${currentVersion}`;
                    titleText = 'osu! Web+ Updated!';
                }

                displayPopup();
            }

            if (window.location.pathname.startsWith('/users/')) {
                await setUserData();
                await updateStatsContainerDisplay();
                await updateLevelBar();
                await updateMedalCount();
                await updatePPCount();
                await setStats();
            }

            console.log(`Page loaded (${window.location.href})`);
        } catch(error) {
            console.log(error);
        }
    }

    function setScoreSection(section, scores) {
        if (!scores?.size) return;

        const scoreContainers = section.querySelectorAll('.play-detail');

        let i = 0;
        for (const score of scores.values()) {
            const container = scoreContainers[i++];
            if (!container) return;

            const title = container.querySelector('.play-detail__title');
            if (title.parentElement.querySelector('.play-detail__score')) continue;

            const comboText = `${score.max_combo.toLocaleString()}x`;

            const scoreDetails = document.createElement('div');
            scoreDetails.className = 'play-detail__score';
            scoreDetails.innerHTML =
                `${(score.legacy_total_score || score.classic_total_score).toLocaleString()} | ` +
                `${score.is_perfect_combo ? `<span style="color: hsl(90,100%,70%)">${comboText}</span>` : comboText} | ` +
                `${(score.statistics.great || 0).toLocaleString()} / ${(score.statistics.ok || 0).toLocaleString()} / ${(score.statistics.meh || 0).toLocaleString()} / ${(score.statistics.miss || 0).toLocaleString()}`;
            title.after(scoreDetails);

            container.querySelector('.play-detail__beatmap').textContent = `${score.beatmap.version} (★${score.beatmap.difficulty_rating.toFixed(2)})`;

            if (section?.previousElementSibling?.textContent?.includes('Best Performance')) {
                container.querySelector('.play-detail__weighted-pp').textContent = `${helpers.formatNumberToFixed(score.weight.pp)}pp`;
                container.querySelector('.play-detail__pp-weight').textContent = `weighted ${score.weight.percentage === 100 ? score.weight.percentage : helpers.formatNumberToFixed(score.weight.percentage)}%`;
            }

            const ppDetails = score.beatmap.status === 'loved' ? '<span class="fas fa-heart"></span>' : (score.pp ? `${helpers.formatNumberToFixed(score.pp)}pp` : '-');
            if (container.querySelector('.play-detail__pp--watch-count')) {
                container.querySelector('.play-detail__weighted-pp').innerHTML = ppDetails
            } else {
                container.querySelector('.play-detail__pp').innerHTML = ppDetails;
            }
        }
    }

    function setScoreSectionEventListener(eventName, sections, observe = true) {
        window.addEventListener(eventName, async () => {
            const userId = helpers.getUserId();
            const scoresMap = helpers.getScoresMap(userId);

            for (const { sectionName, mapKey } of sections) {
                const section = (await helpers.getElementByText('.title--page-extra-small', sectionName)).nextElementSibling;

                if (observe) {
                    const observer = helpers.createObserver(() => {
                        observer.disconnect();
                        setScoreSection(section, scoresMap[mapKey]);
                    });

                    observer.observe(section, { childList: true, subtree: true });
                } else {
                    setScoreSection(section, scoresMap[mapKey]);
                }
            }
        });
    }

    async function reapplyScoreSections() {
        const userId = helpers.getUserId();
        const scoresMap = helpers.getScoresMap(userId);
        const sections = [
            { sectionName: 'Best Performance', mapKey: 'best' },
            { sectionName: 'First Place Ranks', mapKey: 'firsts' },
            { sectionName: 'Pinned Scores', mapKey: 'pinned' },
            { sectionName: 'Recent Plays', mapKey: 'recent' },
            { sectionName: 'Most Watched Replays', mapKey: 'replays' }
        ];

        for (const { sectionName, mapKey } of sections) {
            if (scoresMap[mapKey].size === 0) continue;

            const section = (await helpers.getElementByText('.title--page-extra-small', sectionName)).nextElementSibling;
            setScoreSection(section, scoresMap[mapKey]);
        }
    }

    setScoreSectionEventListener('scores:tops-updated', [
        { sectionName: 'Best Performance', mapKey: 'best' },
        { sectionName: 'First Place Ranks', mapKey: 'firsts' },
        { sectionName: 'Pinned Scores', mapKey: 'pinned' }],
        false
    );
    setScoreSectionEventListener('scores:pinned-updated', [{ sectionName: 'Pinned Scores', mapKey: 'pinned' }]);
    setScoreSectionEventListener('scores:best-updated', [{ sectionName: 'Best Performance', mapKey: 'best' }]);
    setScoreSectionEventListener('scores:firsts-updated', [{ sectionName: 'First Place Ranks', mapKey: 'firsts' }]);
    setScoreSectionEventListener('scores:historical-updated', [
        { sectionName: 'Recent Plays', mapKey: 'recent' },
        { sectionName: 'Most Watched Replays', mapKey: 'replays' }],
        false
    );
    setScoreSectionEventListener('scores:replays-updated', [{ sectionName: 'Most Watched Replays', mapKey: 'replays' }]);
    setScoreSectionEventListener('scores:recent-updated', [{ sectionName: 'Recent Plays', mapKey: 'recent' }]);
    setXHRCapture();
    run();
    document.addEventListener('turbo:load', async () => {
        mutationObservers.forEach(observer => observer.disconnect());
        mutationObservers.length = 0;

        await run();

        if (window.location.pathname.startsWith('/users/')) {
            await reapplyScoreSections();
        }
    });
})();
