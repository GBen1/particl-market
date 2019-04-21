// Copyright (c) 2017-2019, The Particl Market developers
// Distributed under the GPL software license, see the accompanying
// file COPYING or https://github.com/particl/particl-market/blob/develop/LICENSE

import * as resources from 'resources';
import * as _ from 'lodash';
import { inject, named } from 'inversify';
import { validate, request } from '../../../core/api/Validate';
import { Logger as LoggerType } from '../../../core/Logger';
import { Types, Core, Targets } from '../../../constants';
import { ListingItemService } from '../../services/model/ListingItemService';
import { RpcRequest } from '../../requests/RpcRequest';
import { RpcCommandInterface } from '../RpcCommandInterface';
import { Commands} from '../CommandEnumType';
import { BaseCommand } from '../BaseCommand';
import { MessageException } from '../../exceptions/MessageException';
import { SmsgSendResponse } from '../../responses/SmsgSendResponse';
import { ProfileService } from '../../services/model/ProfileService';
import { MarketService } from '../../services/model/MarketService';
import { ProposalActionService } from '../../services/action/ProposalActionService';
import { ItemVote } from '../../enums/ItemVote';
import { ModelNotFoundException } from '../../exceptions/ModelNotFoundException';
import { MissingParamException } from '../../exceptions/MissingParamException';
import { InvalidParamException } from '../../exceptions/InvalidParamException';
import { SmsgSendParams } from '../../requests/action/SmsgSendParams';
import { ProposalCategory } from '../../enums/ProposalCategory';
import { ProposalAddRequest } from '../../requests/action/ProposalAddRequest';

export class ListingItemFlagCommand extends BaseCommand implements RpcCommandInterface<SmsgSendResponse> {

    public log: LoggerType;

    constructor(
        @inject(Types.Core) @named(Core.Logger) public Logger: typeof LoggerType,
        @inject(Types.Service) @named(Targets.Service.model.ListingItemService) public listingItemService: ListingItemService,
        @inject(Types.Service) @named(Targets.Service.model.ProfileService) public profileService: ProfileService,
        @inject(Types.Service) @named(Targets.Service.model.MarketService) public marketService: MarketService,
        @inject(Types.Service) @named(Targets.Service.action.ProposalActionService) public proposalActionService: ProposalActionService
    ) {
        super(Commands.ITEM_FLAG);
        this.log = new Logger(__filename);
    }

    /**
     * data.params[]:
     *  [0]: listingItem: resources.ListingItem
     *  [1]: profile: resources.Profile
     *  [2]: reason
     *  [3]: expiryTime (set in validate)
     *
     * @param data
     * @returns {Promise<SmsgSendResponse>}
     */
    @validate()
    public async execute( @request(RpcRequest) data: RpcRequest): Promise<SmsgSendResponse> {

        const listingItem: resources.ListingItem = data.params[0];
        const profile: resources.Profile = data.params[1];
        const title = listingItem.hash;
        const description = data.params[2];
        const daysRetention = data.params[3];
        const options: string[] = [ItemVote.KEEP, ItemVote.REMOVE];

        // get the ListingItem market.
        const market: resources.Market = listingItem.Market;

        // send from the template profiles address
        const fromAddress = profile.address;

        // send to given market address
        const toAddress = market.address;

        const postRequest = {
            sendParams: new SmsgSendParams(fromAddress, toAddress, true, daysRetention, false),
            sender: profile,
            market,
            category: ProposalCategory.PUBLIC_VOTE, // type should always be PUBLIC_VOTE when using this command
            title,
            description,
            options
        } as ProposalAddRequest;

        return await this.proposalActionService.post(postRequest);
    }

    /**
     * data.params[]:
     *  [0]: listingItemHash
     *  [1]: profileId
     *  [2]: reason, optional
     *
     * @param {RpcRequest} data
     * @returns {Promise<RpcRequest>}
     */
    public async validate(data: RpcRequest): Promise<RpcRequest> {

        if (data.params.length < 1) {
            throw new MissingParamException('listingItemHash');
        } else if (data.params.length < 2) {
            throw new MissingParamException('profileId');
        }

        if (data.params[0] && typeof data.params[0] !== 'string') {
            throw new InvalidParamException('listingItemHash', 'string');
        } else if (data.params[1] && typeof data.params[1] !== 'number') {
            throw new InvalidParamException('profileId', 'number');
        }

        const listingItem: resources.ListingItem = await this.listingItemService.findOneByHash(data.params[0])
            .then(value => value.toJSON())
            .catch(reason => {
                throw new ModelNotFoundException('ListingItem');
            });

        // check if item is already flagged
        if (!_.isEmpty(listingItem.FlaggedItem)) {
            this.log.error('Item is already flagged.');
            throw new MessageException('Item is already flagged.');
        }

        // make sure profile with the id exists
        const profile: resources.Profile = await this.profileService.findOne(data.params[1]).then(value => value.toJSON())
            .catch(reason => {
                this.log.error('Profile not found. ' + reason);
                throw new ModelNotFoundException('Profile');
            });

        const daysRetention = Math.ceil((listingItem.expiredAt  - new Date().getTime()) / 1000 / 60 / 60 / 24);

        data.params[0] = listingItem;
        data.params[1] = profile;
        data.params[2] = data.params[2] ? data.params[2] : 'This ListingItem should be removed.';
        data.params[3] = daysRetention;

        return data;
    }

    public usage(): string {
        return this.getName() + ' <listingItemHash> <profileId> ';
    }

    public help(): string {
        return this.usage() + ' -  ' + this.description() + ' \n'
            + '    <listingItemHash>  - String - The hash of the ListingItem we want to report. \n'
            + '    <profileId>        - Numeric - The ID of the Profile used to report the item. \n'
            + '    <reason>           - String - Optional reason for the flagging';
    }

    public description(): string {
        return 'Report a ListingItem.';
    }
}
