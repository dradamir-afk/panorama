const Router = require('koa-router');
const fs = require('fs');
const { root, modelPath } = require('~/config');
const asyncBusboy = require('async-busboy');
const { createModel, fileExists, sleep } = require('~/utils');
const sharp = require('sharp');
const uuid = require('uuid/v4');
const path = require('path');

const router = new Router();

const _tmp = `${root}/tmp`;

const CONFIG = {
    SHRINK: true,
    NUMBERED_FILE_REGEX: /\d+\..{1,}/,
};

router
    // страница загрузки изображений
    .get(['/', '/new'],
        async ctx => {
            ctx.render('new');
        })
    // обработка загрузки
    .post('/upload',
        async ctx => {
            const files = [];

            const prefix = uuid();

            const loaderController = {
                cnt: 0,
                resolve: null,
                waitForFinish: () => {
                    return new Promise((res) => {
                        loaderController.resolve = res;
                        if (loaderController.cnt === 0) {
                            process.nextTick(() => {
                                res();
                            })
                        }
                    });
                },
                increase: () => {
                    ++loaderController.cnt;
                },
                onFinish: () => {
                    if (--loaderController.cnt === 0) {
                        loaderController.resolve();
                    }
                }
            }

            const { fields } = await asyncBusboy(ctx.req, {
                onFile: function (fieldname, file, filename, enc, mime) {
                    // save to tmp
                    if (mime.indexOf('image/') < 0) {
                        file.resume();
                        return;
                    }
                    const filepath = `${_tmp}/${prefix}_${filename}`;
                    files.push(filepath);
                    // file.pipe(fs.createWriteStream(filepath));

                    // const transformer = sharp()
                    //     .resize(300, null);

                    const out = fs.createWriteStream(filepath);
                    file.pipe(out);
                }
            });

            // check that all names are good
            if (!files.every(file => {
                return CONFIG.NUMBERED_FILE_REGEX.test(path.basename(file));
            })) {
                // there're some badly named files
                ctx.redirect('/?reason=badfilenames');
                return;
            }

            if (fields.shrink === 'on'
                || CONFIG.SHRINK) {
                // shrink
                files.forEach((file, i) => {
                    const transformer = sharp()
                        .resize(300, null);
                    const read = fs.createReadStream(file);
                    loaderController.increase();
                    const outpath = path.resolve(path.dirname(file), 'sh_' + path.basename(file));
                    const out = fs.createWriteStream(outpath);
                    files.splice(i, 1, outpath);
                    out.on('finish', () => {
                        loaderController.onFinish();
                    });
                    read.pipe(transformer).pipe(out);
                });
            }

            // wait for shrinking pipes
            await loaderController.waitForFinish();

            if (files.length <= 0) {
                ctx.redirect('/?reason=wrong');
                return;
            }
            if (files.length > 360) {
                // too much files
                ctx.redirect('/?reason=toomuch');
                return;
            }

            // console.log(files);

            const modelId = await createModel(files);
            if (modelId) {
                ctx.redirect(`/model/${modelId}`);
            } else {
                ctx.redirect('/');
            }
        })
    // страница результата
    .get('/model/:id',
        async ctx => {
            const { id } = ctx.params;

            try {
                await fileExists(`${modelPath}/${id}.jpeg`, fs.F_OK);
            } catch (e) {
                ctx.redirect('/');
                return;
            }

            // get params
            const m = id.match(/(\d+)x(\d+)x(\d+)--.*/);

            ctx.render('model', {
                mw: m[1],
                mh: m[2],
                count: m[3],
                id,
                link: ctx.request.href,
            });
        });

module.exports = router;