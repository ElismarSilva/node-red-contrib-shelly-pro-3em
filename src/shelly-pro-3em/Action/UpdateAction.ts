import { Action, InputDefinition, Output, OutputDefinition } from '@binsoul/node-red-bundle-processing';
import { Input } from '@binsoul/node-red-bundle-processing/dist/Input';
import got from 'got';
import type { Configuration } from '../Configuration';
import { Storage } from '../Storage';

interface GetStatusResult {
    [key: string]: number;
    a_total_act_energy: number;
    a_total_act_ret_energy: number;
    b_total_act_energy: number;
    b_total_act_ret_energy: number;
    c_total_act_energy: number;
    c_total_act_ret_energy: number;
    total_act: number;
    total_act_ret: number;
}

interface DataKey {
    ts: number;
    period: string;
    values: Array<Array<number>>;
}

interface GetDataResult {
    keys: Array<string>;
    data: Array<DataKey>;
    next_record_ts?: number;
}

export class UpdateAction implements Action {
    private readonly configuration: Configuration;
    private readonly storage: Storage;
    private readonly outputCallback: () => void;

    constructor(configuration: Configuration, storage: Storage, outputCallback: () => void) {
        this.configuration = configuration;
        this.storage = storage;
        this.outputCallback = outputCallback;
    }

    defineInput(): InputDefinition {
        return new InputDefinition();
    }

    defineOutput(): OutputDefinition {
        return new OutputDefinition();
    }

    execute(input: Input): Output {
        (async () => {
            const toTimestamp = Math.floor(input.getMessage().timestamp / (60 * 1000)) * 60;
            const fromTimestamp = this.storage.getToTimestamp() || toTimestamp - 60;
            let currentTimestamp = fromTimestamp;

            try {
                const response = await got('http://' + this.configuration.deviceIp + '/rpc/EMData.GetStatus?id=0', { responseType: 'json' });
                const data = response.body as GetStatusResult;
                delete data.id;
                this.storage.setCounters(data);

                let keys: Array<string> | null = null;
                const values: Array<Array<number>> = [];

                while (currentTimestamp) {
                    const response = await got('http://' + this.configuration.deviceIp + '/rpc/EMdata.GetData?id=0&ts=' + currentTimestamp + '&end_ts=' + toTimestamp, { responseType: 'json' });
                    const data = response.body as GetDataResult;
                    if (keys === null) {
                        keys = data.keys;
                    }

                    for (let n = 0; n < data.data.length; n++) {
                        const firstTimestamp = data.data[n].ts;
                        let offset = 0;
                        while (firstTimestamp + offset < fromTimestamp) {
                            data.data[n].values.shift();
                            offset += 60;
                        }

                        for (let i = 0; i < data.data[n].values.length; i++) {
                            values.push(data.data[n].values[i]);
                            offset += 60;
                            if (firstTimestamp + offset >= toTimestamp) {
                                break;
                            }
                        }
                    }

                    currentTimestamp = data.next_record_ts || 0;
                }

                if (keys === null) {
                    this.storage.setError('No keys found in response.');
                } else if (values.length === 0) {
                    this.storage.setError('No values found in response.');
                } else {
                    this.storage.setRecords(keys, values);
                }
            } catch (e) {
                if (e instanceof Error) {
                    this.storage.setError(e.message);
                } else if (typeof e === 'string') {
                    this.storage.setError(e);
                } else {
                    console.log(e);
                }
            }

            this.storage.setFromTimestamp(fromTimestamp);
            this.storage.setToTimestamp(toTimestamp);
            this.outputCallback();
        })();

        return new Output();
    }
}
