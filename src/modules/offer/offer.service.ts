import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { Offer } from 'src/databases/schemas/offer.schema';
import { ObjectId } from 'mongodb';
import { CreateOfferDto } from './dto/createOffer.dto';
import { IUpdateStatus } from './interfaces/updateStatus.interface';
import { Status } from 'src/databases/enums/offer.enum';
import { QueryOfferGet } from './dto/queryOffer.dto';
import { UserService } from '../user/user.service';

@Injectable()
export class OfferService {
  constructor(
    @InjectModel(Offer.name)
    private offerModel: Model<Offer>,
    private readonly userService: UserService,
  ) {}

  async create(createOfferDto: CreateOfferDto) {
    try {
      const tokenIn = createOfferDto.tokenIn.map(
        (token) => new ObjectId(token),
      );
      const tokenOut = createOfferDto.tokenOut.map(
        (token) => new ObjectId(token),
      );
      // const fulfilledAddress = new ObjectId(createOfferDto.fulfilledAddress);
      const trader = await this.userService.findOne({
        walletAddress: createOfferDto.traderAddress,
      });

      return await this.offerModel.create({
        ...createOfferDto,
        traderAddress: trader._id,
        // fulfilledAddress,
        tokenIn,
        tokenOut,
      });
    } catch (err) {
      console.log(err);
      throw err;
    }
  }

  async findAll(query: QueryOfferGet) {
    const { chainId, nftId, status, nftCollectionId } = query;
    const schema: PipelineStage[] = [
      {
        $lookup: {
          from: 'tokens', // Replace with the actual name of your Token collection
          localField: 'tokenIn',
          foreignField: '_id',
          as: 'tokenIn',
        },
      },
      {
        $lookup: {
          from: 'chains',
          localField: 'tokenIn.chain',
          foreignField: '_id',
          as: 'chainTokenIn',
        },
      },
      {
        $lookup: {
          from: 'chains',
          localField: 'tokenOut.chain',
          foreignField: '_id',
          as: 'chainTokenOut',
        },
      },
      {
        $lookup: {
          from: 'tokens', // Replace with the actual name of your Token collection
          localField: 'tokenOut',
          foreignField: '_id',
          as: 'tokenOut',
        },
      },
      {
        $lookup: {
          from: 'chains',
          localField: 'chainA',
          foreignField: '_id',
          as: 'chainA',
        },
      },
      {
        $lookup: {
          from: 'chains',
          localField: 'chainB',
          foreignField: '_id',
          as: 'chainB',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'traderAddress',
          foreignField: '_id',
          as: 'traderAddress',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'fulfilledAddress',
          foreignField: '_id',
          as: 'fulfilledAddress',
        },
      },
      {
        $match: {
          $and: [
            status ? { status: +status } : {},
            chainId
              ? {
                  $or: [
                    { 'chainA.chainId': chainId },
                    { 'chainB.chainId': chainId },
                  ],
                }
              : {},
            nftId
              ? {
                  $or: [
                    { nftIn: { $elemMatch: { nftId: { $regex: nftId } } } },
                    { nftOut: { $elemMatch: { nftId: { $regex: nftId } } } },
                  ],
                }
              : {},
            nftCollectionId
              ? {
                  $or: [
                    {
                      nftIn: {
                        $elemMatch: {
                          nftCollection: new ObjectId(nftCollectionId),
                        },
                      },
                    },
                    {
                      nftOut: {
                        $elemMatch: {
                          nftCollection: new ObjectId(nftCollectionId),
                        },
                      },
                    },
                  ],
                }
              : {},
          ],
        },
      },
      { $sort: { createdAt: -1 } },
    ];

    return await this.offerModel.aggregate(schema).exec();
  }

  async findOne(id: string) {
    return await this.offerModel
      .findById(id)
      .populate('tokenIn')
      .populate('tokenOut')
      .populate('traderAddress')
      .populate('fulfilledAddress')
      .populate('chainA')
      .populate('chainB')
      .exec();
  }

  async updateStatus({ id, status, walletAddress, onChainId }: IUpdateStatus) {
    try {
      const offer = await this.offerModel
        .findById(id)
        .populate('traderAddress')
        .populate('fulfilledAddress')
        .exec();
      if (offer.status > status) throw Error('Invalid status update');

      const user = await this.userService.findOne({ walletAddress });

      const isTraderAddress =
        offer.traderAddress.walletAddress === walletAddress;
      const isFulfilledAddress =
        offer.fulfilledAddress?.walletAddress === walletAddress;

      if (isTraderAddress && status === Status.ACCEPT_A) {
        return await this.offerModel.updateOne(
          {
            _id: id,
            traderAddress: offer.traderAddress['_id'],
          },
          { status, onChainId: onChainId },
        );
      } else if (isFulfilledAddress && status === Status.CONFIRM_B) {
        return await this.offerModel.updateOne(
          {
            _id: id,
            fulfilledAddress: user._id,
          },
          { status },
        );
      } else if (status === Status.ACCEPT_B && !isFulfilledAddress) {
        return await this.offerModel.updateOne(
          { _id: id },
          { fulfilledAddress: user._id, status },
        );
      } else {
        return await this.offerModel.updateOne({ _id: id }, { status });
      }
    } catch (err) {
      console.log(err);
      throw err;
    }
  }

  async history(userId: string, isTrader: string) {
    try {
      const schema =
        isTrader === 'true'
          ? [
              {
                $match: { traderAddress: new ObjectId(userId) },
              },
            ]
          : [
              {
                $match: { fulfilledAddress: new ObjectId(userId) },
              },
            ];
      console.log(schema);
      return await this.offerModel.aggregate(schema).exec();
    } catch (err) {
      console.log(err);
      throw err;
    }
  }
}
