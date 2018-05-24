const BlinkerDebug = require('./BlinkerDebug');
const Utility = require('./BlinkerUtility');
const ut = new Utility();

const EventEmitter = require('events');

var debug = null;

function getInfo(auth) {
    var host = 'https://iotdev.clz.me';
    var url = '/api/v1/user/device/diy/auth?authKey=' + auth;

    var https = require('https');
    https.get(host + url, function(res) {
        var datas = [];
        var size = 0;
        res.on('data', function(data) {
            datas.push(data);
            size += data.length;
            // BlinkerDebug.log('1-> ', data);
        })
        res.on('end', function(data){
            var buff = Buffer.concat(datas, size);

            if (isDebugAll()) {
                BlinkerDebug.log(buff);
            }

            var data = JSON.parse(buff);

            if (data['detail'] == 'device not found') {
                BlinkerDebug.error_log('Please make sure you have put in the right AuthKey!');
            }
            else {
                // BlinkerDebug.log('device found');
                mProto._clientId = data['detail']['deviceName'];
                mProto._username = data['detail']['iotId'];
                mProto._password = data['detail']['iotToken'];
                mProto._productKey = data['detail']['productKey'];
                mProto._uuid = data['detail']['uuid'];
                var broker = data['detail']['broker'];

                if (isDebugAll()) {
                    BlinkerDebug.log('clientId: ', mProto._clientId);
                    BlinkerDebug.log('username: ', mProto._username);
                    BlinkerDebug.log('password: ', mProto._password);
                    BlinkerDebug.log('productKey: ', mProto._productKey);
                    BlinkerDebug.log('uuid: ', mProto._uuid);
                }

                if (broker == 'aliyun') {
                    mProto._subtopic = '/' + mProto._productKey + '/' + mProto._clientId + '/r';
                    mProto._pubtopic = '/' + mProto._productKey + '/' + mProto._clientId + '/s';
                }

                mProto._proto.emit('mInit', mProto._clientId.slice(0, 12));
                mProto._proto.emit('success');
            }
            // var pic = buff.toString('base64');
            // BlinkerDebug.log('3', pic);
            // var test = Buffer(pic, 'base64').toString();
            // BlinkerDebug.log('4', test);
        })
    }).on('error',function(err) {
        BlinkerDebug.error_log('Get Device Info Error...'+err);
    })
}

class ProtoMQTT extends EventEmitter {
    constructor (options) {
        super();

        this._proto = null;
        this._conn = null;

        this._username = null;
        this._password = null;
        this._uuid = null;
        this._productKey = null;
        this._clientId = null;

        this._pubtopic = null;
        this._subtopic = null;

        this._isAlive = false;
        this._printTime = 0;
        this._kaTime = 0;
    }

    setProto(proto) {
        this._proto = proto;
    }

    setConn(conn) {
        this._conn = conn;
    }

    read(message) {
        // BlinkerDebug.log('this._proto.test!');
        this._isAlive = true
        this._kaTime = ut.millis();
        this._proto.emit('mRead', message);
    }

    connected() {
        this._proto.emit('mConnected');
    }

    disconnected() {
        this._proto.emit('mDisconnected');
    }
}

const mProto = new ProtoMQTT();

class BlinkerMQTT extends EventEmitter {
    constructor (options) {
        super();

        this._debug = null;

        mProto.setProto(this);
    }

    setDebug(level) {
        if (level == 'BLINKER_DEBUG_ALL') {
            this._debug = level;
            setLevel(level);
        }
    }

    init(auth) {
        getInfo(auth);

        this.on('success', this.start);
    }

    start() {
        var mqtt = require('/usr/lib/node_modules/mqtt');
        
        var options = {
            clientId : mProto._clientId,
            username : mProto._username,
            password : mProto._password,            
        }

        // BlinkerDebug.log(options.clientId);
        // BlinkerDebug.log(options.username);
        // BlinkerDebug.log(options.password);

        var client  = mqtt.connect('mqtt://public.iot-as-mqtt.cn-shanghai.aliyuncs.com:1883', options);

        mProto._conn = client;

        client.on('connect', function () {
            // var subtopic = '/' + mProto._productKey + '/' + mProto._clientId + '/r';
            client.subscribe(mProto._subtopic);
            // client.publish('presence', 'Hello mqtt')
            BlinkerDebug.log('mqtt connected');
            mProto.connected();
        })
        
        client.on('message', function (topic, message) {
            // message is Buffer
            var data = message.toString();
            if (isDebugAll()) {
                BlinkerDebug.log('Sub data: ', data);
            }
            data = JSON.parse(data);
            data = JSON.stringify(data['data']);
            // BlinkerDebug.log(data);

            mProto.read(data);
            // client.end()
        })

        client.on('error', function(err) {
            BlinkerDebug.log(err);
        })
    }

    pub(msg) {
        var pubtopic = '/' + mProto._productKey + '/' + mProto._clientId + '/s';
        var data = {'fromDevice':mProto._clientID, 'toDevice':mProto._uuid};
        data = JSON.stringify(data);
        data = JSON.parse(data);
        data['data'] = JSON.parse(msg);
        data = JSON.stringify(data);

        if (isDebugAll()) {
            BlinkerDebug.log('Pub topic: ', mProto._pubtopic);
            BlinkerDebug.log('Payload: ', data);
        }

        if (!('notice' in JSON.parse(msg))) {
            if (!checkCanPrint()) {
                return;
            }
        }

        mProto._conn.publish(mProto._pubtopic, data);
        mProto._printTime = ut.millis();
        if (isDebugAll()) {
            BlinkerDebug.log('Successed...');
        }
    }
}

module.exports = BlinkerMQTT;

function checkKA() {
    if (!mProto._isAlive) {
        return false;
    }
    if ((ut.millis() - mProto._kaTime) < 12000) {
        return true;
    }
    else {
        mProto._isAlive = false;
        return false;
    }
}

function checkCanPrint() {
    if (!checkKA()) {
        BlinkerDebug.error_log('MQTT NOT ALIVE OR MSG LIMIT');
        return false;
    }
    if ((ut.millis() - mProto._printTime) >= 1000) {
        return true;
    }
    BlinkerDebug.error_log('MQTT NOT ALIVE OR MSG LIMIT');
    return false;
}

function setLevel(level) {
    if (level == 'BLINKER_DEBUG_ALL') {
        debug = level;
    }
}

function isDebugAll() {
    return debug;
}